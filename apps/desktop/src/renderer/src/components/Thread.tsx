import type { JSX } from 'react';
import type { Action, Step } from '@operator/core';

/**
 * The run as a conversation rather than a log.
 *
 * Each beat leads with the agent's own reason, in plain language, and puts the
 * mechanical detail underneath in mono. Read top to bottom afterwards it should
 * explain what happened to someone who has never heard of a DOM ref.
 */

interface Props {
  steps: Step[];
  streaming: string;
  thinking: boolean;
}

type Tone = 'live' | 'ok' | 'error' | 'human' | 'found';

export function Thread({ steps, streaming, thinking }: Props): JSX.Element {
  return (
    <>
      {steps.map((step) => <Beat key={step.index} step={step} />)}
      {thinking && <div className="murmur">{streaming || 'Reading the page'}</div>}
    </>
  );
}

function Beat({ step }: { step: Step }): JSX.Element {
  const tone = toneOf(step);
  return (
    <div className="beat" data-tone={tone}>
      <div className="beat-rail"><span className="beat-dot" /></div>
      <div>
        <div className="beat-said">{step.thought || describe(step.action)}</div>
        <div className="beat-did">{detail(step)}</div>
      </div>
    </div>
  );
}

function toneOf(step: Step): Tone {
  if (step.verdict.decision === 'handoff') return 'human';
  if (step.verdict.decision === 'reject') return 'error';
  if (step.action.type === 'extract') return 'found';
  if (!step.result) return 'live';
  return step.result.ok ? 'ok' : 'error';
}

function detail(step: Step): string {
  if (step.verdict.decision === 'handoff') return 'paused — over to you';
  if (step.verdict.decision === 'reject') return step.verdict.reason;
  if (step.result?.error) return step.result.error;
  if (step.result) return step.result.detail;
  return describe(step.action);
}

function describe(action: Action): string {
  switch (action.type) {
    case 'navigate': return `open ${action.url}`;
    case 'click': return `click ${action.ref}`;
    case 'type': return `type into ${action.ref}`;
    case 'select': return `choose ${action.value}`;
    case 'setChecked': return action.checked ? 'check the box' : 'uncheck the box';
    case 'scroll': return `scroll ${action.direction}`;
    case 'hover': return `hover ${action.ref}`;
    case 'key': return `press ${action.key}`;
    case 'wait': return `wait ${action.ms}ms`;
    case 'extract': return `record ${action.query}`;
    case 'handoff': return action.reason;
    case 'done': return action.summary;
    case 'fail': return action.reason;
    case 'back': return 'go back';
    case 'forward': return 'go forward';
    case 'reload': return 'reload';
    default: return 'act';
  }
}
