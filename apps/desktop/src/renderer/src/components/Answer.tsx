import { useEffect, useState, type JSX } from 'react';
import type { Action, Step } from '@operator/core';
import type { Finding, RunModel } from '../state.js';
import { isBusy, stateLabel } from '../state.js';
import { Chevron, Trace } from './icons.js';

/**
 * The answer surface.
 *
 * A run produces one thing worth reading — the answer — and a lot of working
 * that is only worth reading when you doubt it. A chat transcript inverts that:
 * it hands you the working and buries the answer at the bottom. So this puts
 * the question, the outcome and the facts up front, and folds the steps away
 * behind a single line you can open when you want to check something.
 *
 * Every fact keeps the page it was read from, and clicking one takes the
 * browser back there and outlines the element. An answer you cannot check is
 * a rumour, and that is the failure mode of every AI search product so far.
 */

interface Props {
  run: RunModel;
  onReveal: (finding: Finding) => void;
}

export function Answer({ run, onReveal }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const busy = isBusy(run.state);

  // While it is still working the steps are the only thing to look at, so they
  // open themselves — and fold away again once there is an answer to read.
  useEffect(() => {
    if (busy && !run.outcome) setOpen(true);
    if (run.outcome) setOpen(false);
  }, [busy, run.outcome]);

  return (
    <div className="answer">
      <div className="asked">{status(run)}</div>
      <h2 className="headline">{run.goal}</h2>

      {run.outcome && (
        <div className="resolution" data-kind={run.outcome.kind}>{run.outcome.message}</div>
      )}

      {run.findings.length > 0 && (
        <div className="facts">
          {run.findings.map((finding, i) => (
            <button className="fact" key={i} onClick={() => onReveal(finding)}>
              <span className="fact-key">{finding.query}</span>
              <span className="fact-value">{format(finding.value)}</span>
              <span className="fact-source">
                <Trace />
                {finding.ref ? 'Show me where this came from' : 'Open the page this came from'}
                {' · '}
                {hostOf(finding.url)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="working">
        <button className="working-toggle" data-open={open} onClick={() => setOpen((v) => !v)}>
          <Chevron />
          {run.steps.length === 0
            ? 'Working'
            : `${run.steps.length} step${run.steps.length === 1 ? '' : 's'}`}
        </button>

        {open && (
          <div className="steps">
            {run.steps.map((step) => <Beat key={step.index} step={step} />)}
            {busy && <div className="murmur">{run.streaming || 'Reading the page'}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function status(run: RunModel): string {
  if (run.state === 'done') {
    return run.steps.length ? `Done · ${run.steps.length} steps` : 'Done';
  }
  if (run.state === 'failed' || run.state === 'cancelled') return stateLabel(run.state);
  if (run.state === 'awaiting-human') return 'Waiting on you';
  return stateLabel(run.state);
}

function Beat({ step }: { step: Step }): JSX.Element {
  return (
    <div className="step" data-tone={toneOf(step)}>
      <div className="step-mark" />
      <div>
        <div className="step-said">{step.thought || describe(step.action)}</div>
        <div className="step-did">{detail(step)}</div>
      </div>
    </div>
  );
}

function toneOf(step: Step): string {
  if (step.verdict.decision === 'handoff') return 'human';
  if (step.verdict.decision === 'reject') return 'error';
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

function format(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
