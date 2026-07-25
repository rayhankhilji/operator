import { useEffect, useRef, useState, type JSX, type Ref } from 'react';
import type { PointerState } from '../state.js';

/**
 * The web page, held as an artifact rather than filling the window.
 *
 * The pointer overlay is the reason this component exists in this shape. The
 * executor reports the exact viewport coordinate it is about to click, and the
 * `<webview>` renders at 1:1 CSS pixels, so those coordinates land correctly on
 * an overlay laid directly over it. The result is that you watch the agent
 * travel to a control and press it, which does more to make the thing legible
 * than any amount of logging.
 */

interface Props {
  src: string;
  yours: boolean;
  pointer: PointerState | null;
  viewRef: Ref<HTMLElement>;
}

export function Stage({ src, yours, pointer, viewRef }: Props): JSX.Element {
  return (
    <div className="stage" data-yours={yours}>
      <div className="card">
        <webview
          ref={viewRef as never}
          src={src}
          partition="persist:operator"
          allowpopups
        />
        <PointerLayer pointer={pointer} />
      </div>
    </div>
  );
}

function PointerLayer({ pointer }: { pointer: PointerState | null }): JSX.Element | null {
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const lastSeq = useRef(-1);

  // A click fires a ring that expands and fades. Keyed by sequence rather than
  // position, so clicking the same button twice still reads as two presses.
  useEffect(() => {
    if (!pointer || pointer.seq === lastSeq.current) return;
    lastSeq.current = pointer.seq;
    if (pointer.kind === 'move') return;

    const ripple = { id: pointer.seq, x: pointer.x, y: pointer.y };
    setRipples((current) => [...current, ripple]);
    const timer = setTimeout(
      () => setRipples((current) => current.filter((r) => r.id !== ripple.id)),
      640,
    );
    return () => clearTimeout(timer);
  }, [pointer]);

  if (!pointer) return null;

  return (
    <div className="pointer-layer">
      {ripples.map((r) => (
        <span className="ripple" key={r.id} style={{ left: r.x, top: r.y }} />
      ))}
      <div className="pointer" style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}>
        {pointer.label && <span className="pointer-label">{pointer.label}</span>}
      </div>
    </div>
  );
}
