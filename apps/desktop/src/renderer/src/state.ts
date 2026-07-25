import type { AgentEvent, Obstacle, RunState, Step } from '@operator/core';

/**
 * The renderer's model of a run.
 *
 * The main process is the source of truth; this is a fold over the event
 * stream. Keeping it a pure reducer means the timeline can be replayed,
 * inspected, and tested without a browser attached.
 */

export interface Interrupt {
  kind: 'confirm' | 'handoff';
  summary: string;
  reason: string;
  obstacle?: Obstacle;
  step?: Step;
}

export interface RunModel {
  runId: string | null;
  goal: string;
  state: RunState;
  steps: Step[];
  /** Partial narration streaming in from the current model call. */
  streaming: string;
  interrupt: Interrupt | null;
  findings: Array<{ query: string; value: unknown }>;
  outcome: { kind: 'done' | 'failed'; message: string } | null;
  observed: { url: string; title: string; nodeCount: number } | null;
}

export const initialRun: RunModel = {
  runId: null,
  goal: '',
  state: 'idle',
  steps: [],
  streaming: '',
  interrupt: null,
  findings: [],
  outcome: null,
  observed: null,
};

export function reduce(model: RunModel, event: AgentEvent): RunModel {
  switch (event.type) {
    case 'run-started':
      return { ...initialRun, runId: event.runId, goal: event.goal, state: 'observing' };

    case 'state':
      return { ...model, state: event.state };

    case 'observed':
      return {
        ...model,
        observed: { url: event.url, title: event.title, nodeCount: event.nodeCount },
      };

    case 'thinking-delta':
      return { ...model, streaming: model.streaming + event.text };

    case 'step-started':
      // The narration is now attached to a step, so the streaming buffer clears.
      return { ...model, streaming: '', steps: upsert(model.steps, event.step) };

    case 'step-finished':
      return { ...model, steps: upsert(model.steps, event.step), interrupt: null };

    case 'confirm-required':
      return {
        ...model,
        interrupt: {
          kind: 'confirm',
          summary: event.summary,
          reason: event.reason,
          step: event.step,
        },
      };

    case 'handoff-required':
      return {
        ...model,
        interrupt: {
          kind: 'handoff',
          summary: event.obstacle.detail,
          reason: event.reason,
          obstacle: event.obstacle,
        },
      };

    case 'human-resumed':
      return { ...model, interrupt: null };

    case 'extracted':
      return { ...model, findings: [...model.findings, { query: event.query, value: event.value }] };

    case 'run-finished':
      return { ...model, state: 'done', interrupt: null, outcome: { kind: 'done', message: event.summary } };

    case 'run-failed':
      return { ...model, state: 'failed', interrupt: null, outcome: { kind: 'failed', message: event.reason } };

    case 'log':
      return model;

    default:
      return model;
  }
}

function upsert(steps: Step[], step: Step): Step[] {
  const index = steps.findIndex((s) => s.index === step.index);
  if (index === -1) return [...steps, step];
  const next = steps.slice();
  next[index] = step;
  return next;
}

/** True while the agent is doing something and the user should not interfere. */
export function isBusy(state: RunState): boolean {
  return state === 'observing' || state === 'thinking' || state === 'acting';
}

/** The one-word status shown in the pill. */
export function stateLabel(state: RunState): string {
  switch (state) {
    case 'idle': return 'Ready';
    case 'observing': return 'Reading the page';
    case 'thinking': return 'Thinking';
    case 'acting': return 'Acting';
    case 'awaiting-human': return 'Your turn';
    case 'done': return 'Done';
    case 'failed': return 'Stopped';
    case 'cancelled': return 'Cancelled';
  }
}

/**
 * Decides whether what the person typed is an address or an instruction.
 *
 * The intent bar accepts both, so this runs on every keystroke to show which
 * one will happen. It errs towards "goal": typing a sentence that happens to
 * contain a dot should not navigate somewhere strange.
 */
export function looksLikeUrl(input: string): boolean {
  const text = input.trim();
  if (!text || /\s/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(text)) return true;
  return false;
}

export function toUrl(input: string): string {
  const text = input.trim();
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}
