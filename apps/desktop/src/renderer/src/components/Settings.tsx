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
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — faster, cheaper' },
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

  const commitDomains = (): void => {
    onSave({
      allowedDomains: domains.split(',').map((d) => d.trim().replace(/^https?:\/\//, '')).filter(Boolean),
    });
  };

  const commitKey = async (): Promise<void> => {
    if (!key.trim()) return;
    await onSetKey(key.trim());
    setKey('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p className="sheet-sub">How Operator behaves, and how much rope it gets.</p>

        <div className="field">
          <label htmlFor="apikey">Anthropic API key</label>
          <input
            id="apikey"
            className="control"
            type="password"
            placeholder={hasApiKey ? '••••••••••••••••  (a key is saved)' : 'sk-ant-…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => void commitKey()}
            onKeyDown={(e) => { if (e.key === 'Enter') void commitKey(); }}
          />
          <div className="field-note">
            {saved && <span className="badge">saved</span>}{' '}
            {hasApiKey && !saved && (
              keyEncrypted
                ? <span className="badge">encrypted by your OS keychain</span>
                : <span className="badge" data-tone="warn">stored unencrypted — no keychain available</span>
            )}
            {' '}The key never leaves the main process, and the page you are browsing
            can never reach it.
          </div>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            className="control"
            value={settings.model}
            onChange={(e) => onSave({ model: e.target.value })}
          >
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="home">Home page</label>
          <input
            id="home"
            className="control"
            value={settings.homeUrl}
            onChange={(e) => onSave({ homeUrl: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="domains">Allowed domains</label>
          <input
            id="domains"
            className="control"
            placeholder="Leave empty to allow any public site"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            onBlur={commitDomains}
            onKeyDown={(e) => { if (e.key === 'Enter') commitDomains(); }}
          />
          <div className="field-note">
            Comma separated. Subdomains are included. Local and private addresses are
            always blocked, whatever you put here.
          </div>
        </div>

        <div className="field">
          <label htmlFor="steps">Step limit — {settings.maxSteps}</label>
          <input
            id="steps"
            className="control"
            type="range"
            min={5}
            max={120}
            step={5}
            value={settings.maxSteps}
            onChange={(e) => onSave({ maxSteps: Number(e.target.value) })}
            style={{ padding: 0, height: 28, border: 'none', background: 'transparent' }}
          />
          <div className="field-note">A hard ceiling, so a confused run cannot spin forever.</div>
        </div>

        <div
          className="switch"
          onClick={() => onSave({ confirmSideEffects: !settings.confirmSideEffects })}
        >
          <div className="switch-copy">
            Ask before every form submission
            <small>
              Purchases, deletions and anything that sends a message always ask,
              regardless of this setting.
            </small>
          </div>
          <div className="track" data-on={settings.confirmSideEffects}><div className="knob" /></div>
        </div>

        <div className="card-actions" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
