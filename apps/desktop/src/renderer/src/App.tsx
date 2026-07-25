import { useCallback, useEffect, useReducer, useRef, useState, type JSX } from 'react';
import type { WebviewTag } from 'electron';
import type { AgentEvent } from '@operator/core';

import { Stage } from './components/Stage.js';
import { Thread } from './components/Thread.js';
import { Composer } from './components/Composer.js';
import { Interrupt } from './components/Interrupt.js';
import { Settings } from './components/Settings.js';
import { Back, Collapse, Expand, Forward, Gear, Lock, Reload } from './components/icons.js';
import { initialRun, isBusy, looksLikeUrl, reduce, toUrl } from './state.js';
import type { Settings as SettingsModel } from '../../preload/index.js';

const SEEDS = [
  'Find the cheapest direct flight from London to Lisbon next month',
  'What does this site charge for its team plan?',
  'Compare the top three stand mixers under £200 and tell me which wins',
  'Summarise the last three posts on this blog',
];

export function App(): JSX.Element {
  const [run, dispatch] = useReducer(reduce, initialRun);
  const [settings, setSettings] = useState<SettingsModel | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [keyEncrypted, setKeyEncrypted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [focus, setFocus] = useState(false);

  const [draft, setDraft] = useState('');
  const [url, setUrl] = useState('');
  const [nav, setNav] = useState({ back: false, forward: false });

  const [viewSrc, setViewSrc] = useState<string | null>(null);
  const [attached, setAttached] = useState(false);
  const [pendingGoal, setPendingGoal] = useState<string | null>(null);

  const view = useRef<WebviewTag | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const started = viewSrc !== null;

  // -- host wiring ----------------------------------------------------------

  useEffect(() => {
    void window.operator.getSettings().then((s) => {
      setSettings(s.settings);
      setHasApiKey(s.hasApiKey);
      setKeyEncrypted(s.keyEncrypted);
      if (!s.hasApiKey) setShowSettings(true);
    });
  }, []);

  useEffect(() => window.operator.onEvent((event: AgentEvent) => dispatch(event)), []);

  useEffect(() => {
    const element = view.current;
    if (!element) return;

    const sync = (): void => {
      setUrl(element.getURL());
      setNav({ back: element.canGoBack(), forward: element.canGoForward() });
    };
    const onReady = (): void => {
      void window.operator.attachView(element.getWebContentsId()).then(() => setAttached(true));
      sync();
    };

    element.addEventListener('dom-ready', onReady);
    element.addEventListener('did-stop-loading', sync);
    element.addEventListener('did-navigate', sync);
    element.addEventListener('did-navigate-in-page', sync);
    return () => {
      element.removeEventListener('dom-ready', onReady);
      element.removeEventListener('did-stop-loading', sync);
      element.removeEventListener('did-navigate', sync);
      element.removeEventListener('did-navigate-in-page', sync);
    };
  }, [started]);

  // Keep the newest beat in view as the thread grows.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [run.steps.length, run.interrupt, run.outcome, run.findings.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      switch (event.key) {
        case 'k': case 'l':
          event.preventDefault(); composer.current?.focus(); composer.current?.select(); break;
        case ',': event.preventDefault(); setShowSettings(true); break;
        case 'r': event.preventDefault(); view.current?.reload(); break;
        case '[': event.preventDefault(); if (view.current?.canGoBack()) view.current.goBack(); break;
        case ']': event.preventDefault(); if (view.current?.canGoForward()) view.current.goForward(); break;
        case '\\': event.preventDefault(); setFocus((v) => !v); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // -- actions --------------------------------------------------------------

  const submit = useCallback((raw?: string) => {
    const text = (raw ?? draft).trim();
    if (!text) return;
    setDraft('');

    if (looksLikeUrl(text)) {
      const target = toUrl(text);
      setUrl(target);
      if (attached) void window.operator.navigate(target);
      else setViewSrc(target);
      return;
    }

    if (!hasApiKey) { setShowSettings(true); return; }

    if (!attached) {
      setViewSrc((current) => current ?? settings?.homeUrl ?? 'about:blank');
      setPendingGoal(text);
      return;
    }

    const from = view.current?.getURL();
    void window.operator.run(text, from && from !== 'about:blank' ? from : settings?.homeUrl);
  }, [draft, hasApiKey, attached, settings?.homeUrl]);

  useEffect(() => {
    if (!attached || !pendingGoal) return;
    const goal = pendingGoal;
    setPendingGoal(null);
    const from = view.current?.getURL();
    void window.operator.run(goal, from && from !== 'about:blank' ? from : settings?.homeUrl);
  }, [attached, pendingGoal, settings?.homeUrl]);

  const saveSettings = useCallback((partial: Partial<SettingsModel>) => {
    setSettings((current) => (current ? { ...current, ...partial } : current));
    void window.operator.saveSettings(partial);
  }, []);

  const setApiKey = useCallback(async (key: string) => {
    const result = await window.operator.setApiKey(key);
    setHasApiKey(result.hasApiKey);
    setKeyEncrypted(result.keyEncrypted);
  }, []);

  const busy = isBusy(run.state);
  const yours = run.interrupt?.kind === 'handoff';

  return (
    <div className="app" data-state={run.state} data-focus={focus && started} data-started={started}
      data-waiting={run.interrupt?.kind ?? ''}>
      <div className="ambience" />

      <header className="topbar">
        <div className="brand"><span className="aperture" /> Operator</div>

        {started && (
          <>
            <button className="ghost" disabled={!nav.back} onClick={() => view.current?.goBack()} title="Back ⌘[">
              <Back />
            </button>
            <button className="ghost" disabled={!nav.forward} onClick={() => view.current?.goForward()} title="Forward ⌘]">
              <Forward />
            </button>
            <button className="ghost" onClick={() => view.current?.reload()} title="Reload ⌘R">
              <Reload />
            </button>
          </>
        )}

        <div className="spacer" />
        {url && (
          <div className="locator" title={url}>
            {url.startsWith('https://') && <span className="lock"><Lock /></span>}
            {url.replace(/^https?:\/\//, '')}
          </div>
        )}
        <div className="spacer" />

        {started && (
          <button
            className={`ghost ${focus ? 'on' : ''}`}
            onClick={() => setFocus((v) => !v)}
            title="Focus the page ⌘\"
          >
            {focus ? <Collapse /> : <Expand />}
          </button>
        )}
        <button className="ghost" onClick={() => setShowSettings(true)} title="Settings ⌘,">
          <Gear />
        </button>
      </header>

      <main className="canvas" ref={canvas}>
        <div className="canvas-inner">
          {started ? (
            <Stage
              src={viewSrc ?? 'about:blank'}
              yours={yours}
              pointer={run.pointer}
              viewRef={view as never}
            />
          ) : (
            <Welcome onPick={(text) => submit(text)} />
          )}

          {started && (
            <div className="thread">
              {run.goal && <div className="ask">{run.goal}</div>}

              {run.outcome && (
                <div className="verdict" data-kind={run.outcome.kind}>{run.outcome.message}</div>
              )}

              {run.findings.length > 0 && (
                <div className="found">
                  {run.findings.map((f, i) => (
                    <div className="found-row" key={i}>
                      <span className="found-key">{f.query}</span>
                      <span className="found-val">{format(f.value)}</span>
                    </div>
                  ))}
                </div>
              )}

              <Thread
                steps={run.steps}
                streaming={run.streaming}
                thinking={run.state === 'thinking' || run.state === 'observing'}
              />
            </div>
          )}
        </div>
      </main>

      {run.interrupt && (
        <Interrupt
          interrupt={run.interrupt}
          onConfirm={(ok) => void window.operator.confirm(ok)}
          onResume={() => void window.operator.resume()}
        />
      )}

      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={() => submit()}
        onStop={() => void window.operator.cancel()}
        busy={busy}
        autoFocus={!started}
        inputRef={composer}
      />

      {showSettings && settings && (
        <Settings
          settings={settings}
          hasApiKey={hasApiKey}
          keyEncrypted={keyEncrypted}
          onSave={saveSettings}
          onSetKey={setApiKey}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }): JSX.Element {
  return (
    <div className="welcome">
      <h1>The browser that <em>goes and does it</em>.</h1>
      <p>
        Say what you want rather than where to find it. Operator reads the page the
        way you would, works through the steps, and stops to ask whenever the next
        move is honestly yours to make.
      </p>
      <div className="seeds">
        {SEEDS.map((seed) => (
          <button className="seed" key={seed} onClick={() => onPick(seed)}>
            <span>→</span><span>{seed}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
