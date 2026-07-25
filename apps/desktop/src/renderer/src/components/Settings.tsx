import { useEffect, useState, type JSX } from 'react';
import type { Settings as SettingsModel } from '../../../preload/index.js';

interface Props {
  settings: SettingsModel;
  hasApiKey: boolean;
  keyEncrypted: boolean;
  onSave: (partial: Partial<SettingsModel>) => void;
  onSetKey: (key: string) => Promise<void>;
  onClose: () => void;
}

const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5 — most capable' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — faster and cheaper' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fastest' },
];

export function Settings({
  settings, hasApiKey, keyEncrypted, onSave, onSetKey, onClose,
}: Props): JSX.Element {
  const [key, setKey] = useState('');
  const [domains, setDomains] = useState(settings.allowedDomains.join(', '));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const commitDomains = (): void =>
    onSave({
      allowedDomains: domains
        .split(',')
        .map((d) => d.trim().replace(/^https?:\/\//, ''))
        .filter(Boolean),
    });

  const commitKey = async (): Promise<void> => {
    if (!key.trim()) return;
    await onSetKey(key.trim());
    setKey('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2400);
  };

  return (
    <div className="veil" onMouseDown={onClose}>
      <div className="panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p className="panel-sub">How Operator behaves, and how much rope it gets.</p>

        <div className="row">
          <label htmlFor="key">Anthropic API key</label>
          <input
            id="key"
            className="input"
            type="password"
            placeholder={hasApiKey ? '••••••••••••••••  a key is saved' : 'sk-ant-…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => void commitKey()}
            onKeyDown={(e) => { if (e.key === 'Enter') void commitKey(); }}
          />
          <div className="hint">
            {saved && <span className="chip">saved</span>}
            {hasApiKey && !saved && (
              keyEncrypted
                ? <span className="chip">held in your OS keychain</span>
                : <span className="chip" data-tone="warn">stored unencrypted — no keychain available</span>
            )}{' '}
            The key stays in the main process. Neither the interface nor any page
            you visit can reach it.
          </div>
        </div>

        <div className="row">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            className="input"
            value={settings.model}
            onChange={(e) => onSave({ model: e.target.value })}
          >
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <div className="hint">
            Every step is one call carrying a page map, so a long run adds up.
            Sonnet is the sensible default while you are trying things out.
          </div>
        </div>

        <div className="row">
          <label htmlFor="home">Opening page</label>
          <input
            id="home"
            className="input"
            value={settings.homeUrl}
            onChange={(e) => onSave({ homeUrl: e.target.value })}
          />
        </div>

        <div className="row">
          <label htmlFor="domains">Allowed domains</label>
          <input
            id="domains"
            className="input"
            placeholder="Leave empty to allow any public site"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            onBlur={commitDomains}
            onKeyDown={(e) => { if (e.key === 'Enter') commitDomains(); }}
          />
          <div className="hint">
            Comma separated; subdomains included. Local and private addresses are
            blocked whatever you put here.
          </div>
        </div>

        <div className="row">
          <label htmlFor="steps">Step limit — {settings.maxSteps}</label>
          <input
            id="steps"
            type="range"
            min={5}
            max={120}
            step={5}
            value={settings.maxSteps}
            onChange={(e) => onSave({ maxSteps: Number(e.target.value) })}
            style={{ width: '100%', accentColor: 'var(--flame)' }}
          />
          <div className="hint">A hard ceiling, so a confused run cannot spin forever.</div>
        </div>

        <div className="toggle" onClick={() => onSave({ confirmSideEffects: !settings.confirmSideEffects })}>
          <div className="toggle-copy">
            Ask before every form submission
            <small>
              Purchases, deletions and anything that sends a message always ask,
              whatever this is set to.
            </small>
          </div>
          <div className="rail" data-on={settings.confirmSideEffects}><div className="nub" /></div>
        </div>

        <div className="choices" style={{ marginTop: 22 }}>
          <button className="btn btn-flame" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
