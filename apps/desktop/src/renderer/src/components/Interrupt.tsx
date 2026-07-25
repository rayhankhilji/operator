import type { JSX } from 'react';
import type { Interrupt as InterruptModel } from '../state.js';
import { Hand, Shield } from './icons.js';

/**
 * The two moments where the run stops and looks at you.
 *
 * These are the most important components in the app, so they get the most
 * deliberate copy. A confirmation must say exactly what is about to happen in
 * words the person can check against the page. A handoff must say what is
 * needed of them, why Operator will not do it, and how to give the page back —
 * without ever sounding like an error.
 */

interface Props {
  interrupt: InterruptModel;
  onConfirm: (approved: boolean) => void;
  onResume: () => void;
}

export function Interrupt({ interrupt, onConfirm, onResume }: Props): JSX.Element {
  return interrupt.kind === 'confirm'
    ? <ConfirmCard interrupt={interrupt} onConfirm={onConfirm} />
    : <HandoffCard interrupt={interrupt} onResume={onResume} />;
}

function ConfirmCard({
  interrupt,
  onConfirm,
}: { interrupt: InterruptModel; onConfirm: (approved: boolean) => void }): JSX.Element {
  return (
    <div className="card" data-kind="confirm">
      <div className="card-title"><Shield /> Needs your approval</div>
      <div className="card-summary">{interrupt.summary}</div>
      <div className="card-reason">
        Operator paused because {interrupt.reason}. Check the page before approving —
        what you see there is the truth, not what is written here.
      </div>
      <div className="card-actions">
        <button className="btn btn-amber" onClick={() => onConfirm(true)}>Approve</button>
        <button className="btn btn-ghost" onClick={() => onConfirm(false)}>Don&rsquo;t do it</button>
      </div>
    </div>
  );
}

function HandoffCard({
  interrupt,
  onResume,
}: { interrupt: InterruptModel; onResume: () => void }): JSX.Element {
  const obstacle = interrupt.obstacle;
  return (
    <div className="card" data-kind="handoff">
      <div className="card-title"><Hand /> The page is yours</div>
      <div className="card-summary">{titleFor(obstacle?.kind)}</div>
      <div className="card-reason">{interrupt.reason}</div>

      {obstacle && obstacle.evidence.length > 0 && (
        <div className="evidence">
          {obstacle.evidence.map((line, i) => <span key={i}>{line}</span>)}
        </div>
      )}

      <div className="card-reason" style={{ marginTop: 10 }}>
        Use the page on the left as you normally would. Operator is not watching your
        keystrokes and will not read what you enter. When you are finished, hand it back
        and it will pick up from wherever you left off.
      </div>

      <div className="card-actions">
        <button className="btn btn-amber" onClick={onResume}>I&rsquo;m done — carry on</button>
      </div>
    </div>
  );
}

function titleFor(kind: string | undefined): string {
  switch (kind) {
    case 'captcha': return 'There is a CAPTCHA to solve.';
    case 'login': return 'This step needs your sign-in details.';
    case 'two-factor': return 'This step needs a code from your phone.';
    case 'payment': return 'This step needs your payment details.';
    case 'paywall': return 'This content is behind a paywall.';
    case 'consent': return 'There is a consent banner to answer.';
    default: return 'This step needs a person.';
  }
}
