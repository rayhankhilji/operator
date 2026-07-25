import Anthropic from '@anthropic-ai/sdk';
import type {
  Action,
  ActionResult,
  AgentEvent,
  Autonomy,
  BrowserDriver,
  PageMap,
  RunState,
  Step,
  Verdict,
} from '../types.js';
import { observe } from '../perception/observer.js';
import { serializePageMap } from '../perception/serialize.js';
import { evaluate } from '../safety/policy.js';
import { Executor, delay } from './executor.js';
import { goalMessage, observationMessage, systemPrompt } from './prompt.js';
import { TOOLS, parseToolCall } from './tools.js';

export const DEFAULT_AUTONOMY: Autonomy = {
  confirmSideEffects: false,
  allowedDomains: [],
  maxSteps: 40,
  maxDurationMs: 10 * 60 * 1000,
};

export interface AgentOptions {
  driver: BrowserDriver;
  apiKey: string;
  model?: string;
  autonomy?: Partial<Autonomy>;
  /** Every event the UI renders flows through here. */
  onEvent?: (event: AgentEvent) => void;
  /** Overridable for tests. */
  client?: Anthropic;
}

export interface RunResult {
  status: 'done' | 'failed' | 'cancelled';
  summary: string;
  data: Record<string, unknown>;
  steps: Step[];
}

/** A pause the loop is sitting in, waiting on a person. */
interface Gate {
  kind: 'confirm' | 'handoff';
  resolve: (approved: boolean) => void;
}

/** One decision from the model, with the raw tool input kept alongside it. */
interface Decision {
  action: Action;
  thought: string;
  toolUseId: string;
  /** The unparsed tool input, for the fields `Action` deliberately drops. */
  input: unknown;
}

/**
 * The Operator agent.
 *
 * Structurally this is a single loop — observe, think, check, act — and almost
 * all of the interesting behaviour lives in how each of those four steps
 * handles being wrong. Pages change between observing and acting. The model
 * picks stale refs. Elements get covered. A run can stop mid-flight because a
 * CAPTCHA appeared. Each of those is handled as an ordinary outcome that feeds
 * back into the next turn, rather than as an exception that ends the run.
 */
export class OperatorAgent {
  private readonly client: Anthropic;
  private readonly driver: BrowserDriver;
  private readonly executor: Executor;
  private readonly model: string;
  private readonly autonomy: Autonomy;
  private readonly emit: (event: AgentEvent) => void;

  private messages: Anthropic.MessageParam[] = [];
  private steps: Step[] = [];
  private extracted: Record<string, unknown> = {};
  private state: RunState = 'idle';
  private gate: Gate | null = null;
  private cancelled = false;
  private currentMap: PageMap | null = null;

  constructor(options: AgentOptions) {
    this.driver = options.driver;
    this.executor = new Executor(options.driver);
    this.model = options.model ?? 'claude-opus-5';
    this.autonomy = { ...DEFAULT_AUTONOMY, ...options.autonomy };
    this.emit = options.onEvent ?? (() => {});
    this.client =
      options.client ??
      new Anthropic({ apiKey: options.apiKey, dangerouslyAllowBrowser: false });
  }

  // -- public control surface ------------------------------------------------

  /** The person approved (or declined) the action the loop is paused on. */
  respondToConfirm(approved: boolean): void {
    if (this.gate?.kind === 'confirm') {
      const gate = this.gate;
      this.gate = null;
      gate.resolve(approved);
    }
  }

  /** The person finished with the page and is handing it back. */
  resumeFromHandoff(): void {
    if (this.gate?.kind === 'handoff') {
      const gate = this.gate;
      this.gate = null;
      this.emit({ type: 'human-resumed' });
      gate.resolve(true);
    }
  }

  /** Stop as soon as the current action finishes. */
  cancel(): void {
    this.cancelled = true;
    // A run paused on a person would otherwise wait forever.
    if (this.gate) {
      const gate = this.gate;
      this.gate = null;
      gate.resolve(false);
    }
  }

  getState(): RunState {
    return this.state;
  }

  // -- the loop --------------------------------------------------------------

  async run(goal: string, startUrl?: string): Promise<RunResult> {
    const runId = `run_${Date.now().toString(36)}`;
    const startedAt = Date.now();
    this.emit({ type: 'run-started', goal, runId });

    if (startUrl) {
      await this.driver.navigate(startUrl);
    }

    this.messages = [
      { role: 'user', content: goalMessage(goal, startUrl ?? (await this.safeUrl())) },
    ];

    let pendingObservation = true;

    for (let stepIndex = 0; stepIndex < this.autonomy.maxSteps; stepIndex++) {
      if (this.cancelled) return this.finish('cancelled', 'Stopped by the user.');
      if (Date.now() - startedAt > this.autonomy.maxDurationMs) {
        return this.finish('failed', 'The run hit its time limit.');
      }

      // 1. Observe.
      if (pendingObservation) {
        this.setState('observing');
        try {
          this.currentMap = await observe(this.driver);
        } catch (error) {
          return this.finish('failed', `Could not read the page: ${describeError(error)}`);
        }
        this.emit({
          type: 'observed',
          url: this.currentMap.url,
          title: this.currentMap.title,
          nodeCount: this.currentMap.nodes.length,
          obstacles: this.currentMap.obstacles,
        });
        this.appendObservation(this.currentMap);
        pendingObservation = false;
      }

      const map = this.currentMap;
      if (!map) return this.finish('failed', 'Lost track of the page.');

      // 2. Think.
      this.setState('thinking');
      let decision: Decision | null;
      try {
        decision = await this.think();
      } catch (error) {
        return this.finish('failed', `The model call failed: ${describeError(error)}`);
      }

      if (!decision) {
        // The model replied with prose and no tool call. Nudge it once.
        this.messages.push({
          role: 'user',
          content: 'Choose exactly one tool call now. If you are finished, call done.',
        });
        continue;
      }

      const step: Step = {
        index: this.steps.length,
        thought: decision.thought,
        action: decision.action,
        verdict: { decision: 'allow' },
        url: map.url,
        startedAt: Date.now(),
      };

      // 3. Check.
      const verdict = evaluate(decision.action, map, this.autonomy);
      step.verdict = verdict;
      this.emit({ type: 'step-started', step });

      const outcome = await this.applyVerdict(step, verdict, decision.toolUseId);
      if (outcome.terminal) return outcome.terminal;
      if (outcome.skip) {
        pendingObservation = outcome.reobserve;
        continue;
      }

      // 4. Act.
      this.setState('acting');
      const resolved = this.resolveWithoutPage(step, decision);
      if (resolved.kind === 'finished') return resolved.result;
      if (resolved.kind === 'handled') {
        // The action was settled here and has already reported its own
        // tool_result. Falling through would emit a second one for the same
        // tool_use_id, which is malformed.
        pendingObservation = false;
        continue;
      }

      const result = await this.executor.run(decision.action, map);
      step.result = result;
      step.endedAt = Date.now();
      this.steps.push(step);
      this.emit({ type: 'step-finished', step });

      this.pushToolResult(
        decision.toolUseId,
        result.ok ? `OK — ${result.detail}` : `FAILED — ${result.error ?? result.detail}`,
        result.ok,
      );

      pendingObservation = result.pageChanged;
      if (!pendingObservation) {
        // Nothing moved, so the previous map still stands; tell the model that
        // explicitly rather than silently repeating an identical observation.
        this.messages.push({
          role: 'user',
          content: 'The page did not change. Continue from the same page map.',
        });
      }
    }

    return this.finish('failed', `Ran out of steps after ${this.autonomy.maxSteps} actions.`);
  }

  // -- loop internals --------------------------------------------------------

  /** One model call. Returns the chosen action, or null if it did not choose. */
  private async think(): Promise<Decision | null> {
    const message = await this.callModel();
    this.messages.push({ role: 'assistant', content: message.content });

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) return null;

    const narration = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim();

    const parsed = parseToolCall(toolUse.name, toolUse.input);
    return {
      action: parsed.action,
      thought: parsed.thought || narration || toolUse.name,
      toolUseId: toolUse.id,
      input: toolUse.input,
    };
  }

  /**
   * One streamed model call, retried through the failures that are worth
   * retrying.
   *
   * A long run is dozens of calls, so over a whole task the chance of hitting a
   * rate limit or a momentarily overloaded model is not small. Losing forty
   * steps of real progress — some of which the person sat through a handoff for
   * — because of one 429 would be a poor trade, so transient failures cost a
   * pause rather than the run. Anything else is a real error and is raised.
   */
  private async callModel(): Promise<Anthropic.Message> {
    const MAX_ATTEMPTS = 4;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (this.cancelled) throw new Error('cancelled');

      try {
        const stream = this.client.messages.stream({
          model: this.model,
          max_tokens: 2048,
          system: systemPrompt(this.autonomy),
          tools: TOOLS,
          messages: this.outboundMessages(),
        });
        stream.on('text', (text) => this.emit({ type: 'thinking-delta', text }));
        return await stream.finalMessage();
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;

        const waitMs = backoffMs(error, attempt);
        this.emit({
          type: 'log',
          level: 'warn',
          message: `Model call failed (${describeError(error)}). Retrying in ${Math.round(waitMs / 1000)}s — attempt ${attempt + 1} of ${MAX_ATTEMPTS}.`,
        });
        await delay(waitMs);
      }
    }
    throw lastError;
  }

  /**
   * Handles everything the policy engine can say. Returns instructions for the
   * loop rather than acting directly, so the control flow stays in one place.
   */
  private async applyVerdict(
    step: Step,
    verdict: Verdict,
    toolUseId: string,
  ): Promise<{ terminal?: RunResult; skip?: boolean; reobserve: boolean }> {
    switch (verdict.decision) {
      case 'allow':
        return { reobserve: false };

      case 'reject': {
        // Structurally wrong — usually a stale ref. Re-read and let it retry.
        this.close(step, { ok: false, detail: 'blocked', error: verdict.reason, pageChanged: false });
        this.pushToolResult(toolUseId, `REJECTED — ${verdict.reason}`, false);
        return { skip: true, reobserve: true };
      }

      case 'confirm': {
        this.setState('awaiting-human');
        this.emit({
          type: 'confirm-required',
          step,
          summary: verdict.summary,
          reason: verdict.reason,
        });
        const approved = await this.waitForGate('confirm');
        if (this.cancelled) {
          return { terminal: this.finish('cancelled', 'Stopped by the user.'), reobserve: false };
        }
        if (!approved) {
          this.close(step, {
            ok: false, detail: 'declined', error: 'the person declined', pageChanged: false,
          });
          this.pushToolResult(
            toolUseId,
            'DECLINED — the person did not approve this action. Find another way, or ask ' +
              'them what they would prefer via handoff.',
            false,
          );
          return { skip: true, reobserve: true };
        }
        return { reobserve: false };
      }

      case 'handoff': {
        this.setState('awaiting-human');
        this.emit({ type: 'handoff-required', obstacle: verdict.obstacle, reason: verdict.reason });
        this.close(step, { ok: true, detail: 'handed to the person', pageChanged: true });

        await this.waitForGate('handoff');
        if (this.cancelled) {
          return { terminal: this.finish('cancelled', 'Stopped by the user.'), reobserve: false };
        }

        this.pushToolResult(
          toolUseId,
          'The person has taken over, done what was needed, and handed the page back. ' +
            'The page may be completely different now — read the new page map carefully ' +
            'before deciding anything.',
          true,
        );
        return { skip: true, reobserve: true };
      }
    }
  }

  /**
   * Settles the actions that never touch the page.
   *
   * The three outcomes are kept explicit rather than encoded as `null`, because
   * "this ended the run", "this is fully dealt with" and "this still needs to
   * be executed" are genuinely different instructions to the caller — and
   * conflating the last two means reporting a `tool_result` twice for one
   * `tool_use_id`.
   */
  private resolveWithoutPage(
    step: Step,
    decision: Decision,
  ): { kind: 'finished'; result: RunResult } | { kind: 'handled' } | { kind: 'act' } {
    const action = step.action;

    switch (action.type) {
      case 'done': {
        this.close(step, { ok: true, detail: 'finished', pageChanged: false });
        if (action.data !== undefined) this.extracted.result = action.data;
        return { kind: 'finished', result: this.finish('done', action.summary) };
      }

      case 'fail': {
        this.close(step, { ok: false, detail: 'gave up', error: action.reason, pageChanged: false });
        return { kind: 'finished', result: this.finish('failed', action.reason) };
      }

      case 'extract': {
        // The model hands the value over directly. It read it off the page map
        // that is already in context, so going back to the page would only risk
        // reading something that has since changed.
        const value = (decision.input as { value?: unknown }).value ?? null;
        this.extracted[action.query] = value;
        this.emit({ type: 'extracted', query: action.query, value });
        this.close(step, { ok: true, detail: `recorded ${action.query}`, pageChanged: false });
        this.pushToolResult(decision.toolUseId, `Recorded "${action.query}".`, true);
        return { kind: 'handled' };
      }

      default:
        return { kind: 'act' };
    }
  }

  /** Finalises a step and publishes it, so every exit path looks the same. */
  private close(step: Step, result: ActionResult): void {
    step.result = result;
    step.endedAt = Date.now();
    this.steps.push(step);
    this.emit({ type: 'step-finished', step });
  }

  private waitForGate(kind: Gate['kind']): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.gate = { kind, resolve };
    });
  }

  private appendObservation(map: PageMap): void {
    const text = serializePageMap(map);
    const note = map.obstacles.length
      ? 'Note: this page has something on it that may need a person.'
      : undefined;

    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'user' && Array.isArray(last.content)) {
      last.content.push({ type: 'text', text: observationMessage(text, note) });
    } else {
      this.messages.push({ role: 'user', content: observationMessage(text, note) });
    }
  }

  private pushToolResult(toolUseId: string, content: string, ok: boolean): void {
    this.messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content, is_error: !ok },
      ],
    });
  }

  /**
   * Keeps the conversation from growing without bound.
   *
   * Page maps are by far the largest thing in the history and the least useful
   * once superseded — a map from eight steps ago describes a page that no
   * longer exists. Older ones are replaced with a stub, which keeps the shape
   * of the conversation intact (every tool_use still has its tool_result) while
   * dropping the bulk.
   */
  private outboundMessages(): Anthropic.MessageParam[] {
    return mergeAdjacent(this.prune());
  }

  private prune(): Anthropic.MessageParam[] {
    const KEEP_FULL_MAPS = 3;
    let seen = 0;

    return [...this.messages].reverse().map((message) => {
      if (message.role !== 'user' || typeof message.content === 'string') return message;

      const content = message.content.map((block) => {
        if (typeof block === 'string' || block.type !== 'text') return block;
        if (!block.text.includes('<page-map>')) return block;
        seen++;
        if (seen <= KEEP_FULL_MAPS) return block;
        const url = /URL: (\S+)/.exec(block.text)?.[1] ?? 'a page';
        return { ...block, text: `<page-map url="${url}">(superseded — omitted)</page-map>` };
      });

      return { ...message, content };
    }).reverse();
  }

  private setState(state: RunState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
  }

  private finish(status: RunResult['status'], summary: string): RunResult {
    this.setState(status === 'done' ? 'done' : status === 'cancelled' ? 'cancelled' : 'failed');
    if (status === 'done') {
      this.emit({ type: 'run-finished', summary, data: this.extracted, steps: this.steps.length });
    } else {
      this.emit({ type: 'run-failed', reason: summary });
    }
    return { status, summary, data: this.extracted, steps: this.steps };
  }

  private async safeUrl(): Promise<string | undefined> {
    try {
      const url = await this.driver.url();
      return url && url !== 'about:blank' ? url : undefined;
    } catch {
      return undefined;
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Statuses worth trying again: the request was fine, the moment was not. */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status);

  // Connection-level failures carry no status but are equally transient.
  const message = describeError(error).toLowerCase();
  return /econnreset|etimedout|enotfound|econnrefused|socket hang up|network|fetch failed|aborted/.test(
    message,
  );
}

/** Exponential backoff, but a server-supplied `retry-after` always wins. */
function backoffMs(error: unknown, attempt: number): number {
  const headers = (error as { headers?: Record<string, string> })?.headers;
  const retryAfter = Number(headers?.['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 60_000);
  }
  const base = 1000 * 2 ** (attempt - 1);
  return Math.min(base + Math.random() * 400, 30_000); // jitter, so parallel runs do not sync up
}

/**
 * Collapses runs of same-role messages into single turns.
 *
 * The loop appends to the transcript from several places — the goal, an
 * observation, a tool result, a nudge — and whether two of them land next to
 * each other depends on the path taken through the run. Rather than make every
 * call site aware of what preceded it, the conversation is normalised once on
 * the way out. It also guarantees a strictly alternating transcript, which is
 * what the Messages API expects.
 */
function mergeAdjacent(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    const previous = out[out.length - 1];
    if (previous && previous.role === message.role) {
      out[out.length - 1] = {
        role: message.role,
        content: [...asBlocks(previous.content), ...asBlocks(message.content)],
      };
    } else {
      out.push(message);
    }
  }
  return out;
}

function asBlocks(content: Anthropic.MessageParam['content']): Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content as Anthropic.ContentBlockParam[];
}

export { delay };
