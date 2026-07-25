import Anthropic from '@anthropic-ai/sdk';
import type {
  Action,
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
      let decision: { action: Action; thought: string; toolUseId: string } | null;
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
      const terminal = await this.performTerminalIfAny(step, decision.toolUseId);
      if (terminal) return terminal;

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
  private async think(): Promise<{ action: Action; thought: string; toolUseId: string } | null> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt(this.autonomy),
      tools: TOOLS,
      messages: this.prunedMessages(),
    });

    stream.on('text', (text) => this.emit({ type: 'thinking-delta', text }));

    const message = await stream.finalMessage();
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
    };
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
        step.result = { ok: false, detail: 'blocked', error: verdict.reason, pageChanged: false };
        step.endedAt = Date.now();
        this.steps.push(step);
        this.emit({ type: 'step-finished', step });
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
          step.result = { ok: false, detail: 'declined', error: 'the person declined', pageChanged: false };
          step.endedAt = Date.now();
          this.steps.push(step);
          this.emit({ type: 'step-finished', step });
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
        step.result = { ok: true, detail: 'handed to the person', pageChanged: true };
        step.endedAt = Date.now();
        this.steps.push(step);
        this.emit({ type: 'step-finished', step });

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

  /** Resolves the three actions that end or annotate a run rather than act. */
  private async performTerminalIfAny(step: Step, toolUseId: string): Promise<RunResult | null> {
    const action = step.action;

    if (action.type === 'done') {
      step.result = { ok: true, detail: 'finished', pageChanged: false };
      step.endedAt = Date.now();
      this.steps.push(step);
      this.emit({ type: 'step-finished', step });
      if (action.data !== undefined) this.extracted.result = action.data;
      return this.finish('done', action.summary);
    }

    if (action.type === 'fail') {
      step.result = { ok: false, detail: 'gave up', error: action.reason, pageChanged: false };
      step.endedAt = Date.now();
      this.steps.push(step);
      this.emit({ type: 'step-finished', step });
      return this.finish('failed', action.reason);
    }

    if (action.type === 'extract') {
      // The model supplies the value directly; the page map it read is already
      // in context, so a second round-trip to the page would add nothing.
      const raw = (step.action as { query: string }).query;
      const value = this.lastToolInputValue();
      this.extracted[raw] = value;
      this.emit({ type: 'extracted', query: raw, value });
      step.result = { ok: true, detail: `recorded ${raw}`, pageChanged: false };
      step.endedAt = Date.now();
      this.steps.push(step);
      this.emit({ type: 'step-finished', step });
      this.pushToolResult(toolUseId, `Recorded "${raw}".`, true);
      return null;
    }

    if (action.type === 'handoff') {
      // Reached only when the model asks for a person without the policy engine
      // having already routed it; `applyVerdict` handles the common path.
      return null;
    }

    return null;
  }

  /** Pulls the `value` out of the most recent extract tool call. */
  private lastToolInputValue(): unknown {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message.role !== 'assistant' || typeof message.content === 'string') continue;
      for (const block of message.content) {
        if (typeof block !== 'string' && block.type === 'tool_use' && block.name === 'extract') {
          return (block.input as { value?: unknown }).value;
        }
      }
    }
    return null;
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
  private prunedMessages(): Anthropic.MessageParam[] {
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

export { delay };
