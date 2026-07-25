import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react';
import { looksLikeUrl } from '../state.js';
import { Send, Square } from './icons.js';

/**
 * The one way in.
 *
 * There is no separate address bar. You either say where to go or say what you
 * want done, and the composer works out which — showing you its reading above
 * the field rather than making you choose a mode first. The distinction matters
 * to the software and should not matter to the person.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  autoFocus?: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}

export function Composer({
  value, onChange, onSubmit, onStop, busy, autoFocus, inputRef,
}: Props): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null);

  // Grow with the content rather than scrolling a one-line field.
  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }, [value, inputRef]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, inputRef]);

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
    if (event.key === 'Escape' && busy) onStop();
  };

  const trimmed = value.trim();
  const isUrl = trimmed.length > 0 && looksLikeUrl(trimmed);

  return (
    <div className="dock">
      <div className="composer-wrap" ref={wrap}>
        {trimmed.length > 0 && (
          <span className="mode-hint">
            {isUrl ? 'go straight there' : 'operator will work this out'}
          </span>
        )}

        <div className="composer">
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            placeholder={busy ? 'Operator is working — Esc to stop' : 'Where to, or what would you like done?'}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
          />

          {busy ? (
            <button className="send" data-stop="true" onClick={onStop} title="Stop (Esc)">
              <Square />
            </button>
          ) : (
            <button
              className="send"
              data-ready={trimmed.length > 0}
              onClick={onSubmit}
              disabled={!trimmed}
              title="Send (Enter)"
            >
              <Send />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
