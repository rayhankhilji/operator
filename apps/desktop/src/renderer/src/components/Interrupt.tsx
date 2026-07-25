import type { JSX } from 'react';
import type { Interrupt as InterruptModel } from '../state.js';
import { Hand, Shield } from './icons.js';

/**
 * The two moments where the run stops and looks at you.
 *
 * These get the most deliberate copy in the app. A confirmation has to say what
 * is about to happen in words you can check against the page in front of you. A
 * handoff has to say what is needed, why Operator will not do it, and how to
 * give the page back — while never once sounding like an error, because it is
 * not one.
 */

interface Props {
  interrupt: InterruptModel;
  onConfirm: (approved: boolean) => void;
  onResume: () => void;
}

export function Interrupt({ interrupt, onConfirm, onResume }: Props): JSX.Element {
  return interrupt.kind === 'confirm'
    ? <Confirm interrupt={interrupt} onConfirm={onConfirm} />
    : <Handoff interrupt={interrupt} onResume={onResume} />;
}

function Confirm({
  interrupt, onConfirm,
}: { interrupt: InterruptModel; onConfirm: (ok: boolean) => void }): JSX.Element {
  return (
    <div className="interrupt" data-kind="confirm">
      <div className="interrupt-tag"><Shield /> Your call</div>
      <h3>{interrupt.summary}</h3>
      <p>
        Operator stopped because {interrupt.reason}. The page on the card above is
        the real one — check it there before you decide, rather than taking this
        summary at its word.
      </p>
      <div className="choices">
        <button className="btn btn-flame" onClick={() => onConfirm(true)}>Go ahead</button>
        <button className="btn btn-quiet" onClick={() => onConfirm(false)}>Don&rsquo;t</button>
      </div>
    </div>
  );
}

function Handoff({
  interrupt, onResume,
}: { interrupt: InterruptModel; onResume: () => void }): JSX.Element {
  const obstacle = interrupt.obstacle;

  return (
    <div className="interrupt" data-kind="handoff">
      <div className="interrupt-tag"><Hand /> Over to you</div>
      <h3>{headline(obstacle?.kind)}</h3>
      <p>{interrupt.reason}</p>

      {obstacle && obstacle.evidence.length > 0 && (
        <div className="receipts">
          {obstacle.evidence.map((line, i) => <span key={i}>{line}</span>)}
        </div>
      )}

      <p>
        The card above is live — use it exactly as you would any other browser.
        Operator is not reading your keystrokes and never sees what you enter.
        When you are done, hand it back and it will look at the page afresh and
        carry on from wherever you left it.
      </p>

      <div className="choices">
        <button className="btn btn-tide" onClick={onResume}>Done — carry on</button>
      </div>
    </div>
  );
}

function headline(kind: string | undefined): string {
  switch (kind) {
    case 'captcha': return 'There’s a CAPTCHA in the way.';
    case 'login': return 'This one needs your sign-in.';
    case 'two-factor': return 'This needs a code from your phone.';
    case 'payment': return 'This needs your payment details.';
    case 'paywall': return 'This is behind a paywall.';
    case 'consent': return 'There’s a consent banner to answer.';
    default: return 'This part needs a person.';
  }
}
