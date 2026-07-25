import type { JSX } from 'react';
import type { Action, Step } from '@operator/core';

import {
  Bookmark, Check, ChevronsDown, Clock, Cross, Cursor, Eye, Globe, Hand, Keyboard, Shield,
} from './icons.js';

/**
 * The run, as a story.
 *
 * The design intent: someone should be able to read this top to bottom
 * afterwards and understand exactly what happened and why, without knowing
 * anything about DOM refs. So each entry leads with the agent's own reason
 * and puts the mechanical detail underneath, in mono, as supporting evidence.
 */

interface Props {
  steps: Step[];
  streaming: string;
  thinking: boolean;
}

export function Timeline({ steps, streaming, thinking }: Props): JSX.Element {
  return (
    <div className="timeline">
      {steps.map((step) => (
        <StepRow key={step.index} step={step} />
      ))}
      {thinking && <Thinking text={streaming} />}
    </div>
  );
}

function StepRow({ step }: { step: Step }): JSX.Element {
  const status = statusOf(step);
  return (
    <div className="step" data-status={status}>
      <div className="step-icon">{iconFor(step, status)}</div>
      <div className="step-body">
        <div className="step-thought">{step.thought || describeAction(step.action)}</div>
        <div className="step-detail">{detailFor(step)}</div>
      </div>
    </div>
  );
}

function Thinking({ text }: { text: string }): JSX.Element {
  return (
    <div className="thinking">
      <div className="step-icon" style={{ background: 'transparent', border: 'none' }}>
        <span className="spinner" />
      </div>
      <div className="thinking-text">
        {text || 'Working out what to do next'}
        <span className="caret" />
      </div>
    </div>
  );
}

type Status = 'running' | 'ok' | 'error' | 'blocked';

function statusOf(step: Step): Status {
  if (step.verdict.decision === 'handoff') return 'blocked';
  if (step.verdict.decision === 'reject') return 'blocked';
  if (!step.result) return 'running';
  return step.result.ok ? 'ok' : 'error';
}

function iconFor(step: Step, status: Status): JSX.Element {
  if (status === 'blocked') return <Hand />;
  if (status === 'error') return <Cross />;

  switch (step.action.type) {
    case 'navigate': return <Globe />;
    case 'click': return <Cursor />;
    case 'type': return <Keyboard />;
    case 'select':
    case 'setChecked': return <Check />;
    case 'scroll': return <ChevronsDown />;
    case 'hover': return <Eye />;
    case 'wait': return <Clock />;
    case 'extract': return <Bookmark />;
    case 'handoff': return <Hand />;
    case 'done': return <Check />;
    case 'fail': return <Cross />;
    default: return <Shield />;
  }
}

/** The mechanical line under the thought. */
function detailFor(step: Step): JSX.Element | string {
  if (step.verdict.decision === 'handoff') return 'Paused — this one is yours';
  if (step.verdict.decision === 'reject') return step.verdict.reason;
  if (step.result?.error) return step.result.error;
  if (step.result) return step.result.detail;
  return describeAction(step.action);
}

/** A fallback description, for when the model gave no reason of its own. */
function describeAction(action: Action): string {
  switch (action.type) {
    case 'navigate': return `Open ${action.url}`;
    case 'click': return `Click ${action.ref}`;
    case 'type': return `Type into ${action.ref}`;
    case 'select': return `Choose ${action.value}`;
    case 'setChecked': return action.checked ? 'Check the box' : 'Uncheck the box';
    case 'scroll': return `Scroll ${action.direction}`;
    case 'hover': return `Hover ${action.ref}`;
    case 'key': return `Press ${action.key}`;
    case 'wait': return `Wait ${action.ms}ms`;
    case 'extract': return `Record ${action.query}`;
    case 'handoff': return action.reason;
    case 'done': return action.summary;
    case 'fail': return action.reason;
    case 'back': return 'Go back';
    case 'forward': return 'Go forward';
    case 'reload': return 'Reload';
    default: return 'Act';
  }
}
