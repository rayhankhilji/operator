import { useCallback, useEffect, useReducer, useRef, useState, type JSX } from 'react';
import type { WebviewTag } from 'electron';
import type { AgentEvent } from '@operator/core';

import { Stage } from './components/Stage.js';
import { Answer } from './components/Answer.js';
import { Composer } from './components/Composer.js';
import { Interrupt } from './components/Interrupt.js';
import { Settings } from './components/Settings.js';
import { Back, Chevron, Collapse, Expand, Forward, Gear, Lock, Reload } from './components/icons.js';
import { initialRun, isBusy, looksLikeUrl, reduce, toUrl, type Finding } from './state.js';
import type { Settings as SettingsModel } from '../../preload/index.js';

const SUGGESTIONS = [
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

  /**
   * Light is the design; dark and system are choices. Following the OS by
   * default would quietly hand half the people a product nobody designed.
   */
  useEffect(() => {
    const choice = settings?.theme ?? 'light';
    const root = document.documentElement;

    const apply = (): void => {
      const dark = choice === 'dark'
        || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();

    if (choice !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [settings?.theme]);

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

  // Follow the answer as it fills in.
  useEffect(() => {
    canvas.current?.scrollTo({ top: canvas.current.scrollHeight, behavior: 'smooth' });
  }, [run.findings.length, run.outcome, run.interrupt]);

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

  /** Take the browser back to where a fact was read and outline it. */
  const reveal = useCallback((finding: Finding) => {
    setFocus(false);
    void window.operator.reveal(finding.url, finding.ref);
    canvas.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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

  return (
    <div
      className="app"
      data-state={run.state}
      data-busy={busy}
      data-focus={focus && started}
      data-started={started}
    >
      <header className="bar">
        <div className="wordmark"><span className="ring" /> Operator</div>

        {started && (
          <>
            <button className="icon" disabled={!nav.back} onClick={() => view.current?.goBack()} title="Back ⌘[">
              <Back />
            </button>
            <button className="icon" disabled={!nav.forward} onClick={() => view.current?.goForward()} title="Forward ⌘]">
              <Forward />
            </button>
            <button className="icon" onClick={() => view.current?.reload()} title="Reload ⌘R">
              <Reload />
            </button>
          </>
        )}

        <div className="grow" />
        {url && (
          <div className="address" title={url}>
            {url.startsWith('https://') && <Lock />}
            {url.replace(/^https?:\/\//, '')}
          </div>
        )}
        <div className="grow" />

        {started && (
          <button
            className={`icon ${focus ? 'on' : ''}`}
            onClick={() => setFocus((v) => !v)}
            title="Focus the page ⌘\"
          >
            {focus ? <Collapse /> : <Expand />}
          </button>
        )}
        <button className="icon" onClick={() => setShowSettings(true)} title="Settings ⌘,">
          <Gear />
        </button>

        <div className="progress" />
      </header>

      <main className="canvas" ref={canvas}>
        <div className="inner">
          {started ? (
            <Stage
              src={viewSrc ?? 'about:blank'}
              yours={run.interrupt?.kind === 'handoff'}
              pointer={run.pointer}
              viewRef={view as never}
            />
          ) : (
            <Opening onPick={(text) => submit(text)} />
          )}

          {started && run.goal && <Answer run={run} onReveal={reveal} />}
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

function Opening({ onPick }: { onPick: (text: string) => void }): JSX.Element {
  return (
    <div className="opening">
      <h1>Ask for the outcome.<br /><span>Not the website.</span></h1>
      <p>
        Operator reads pages the way you do, works through the steps, and shows you
        where every answer came from. It stops and asks whenever the next move is
        honestly yours.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((text) => (
          <button className="suggestion" key={text} onClick={() => onPick(text)}>
            {text}
            <Chevron />
          </button>
        ))}
      </div>
    </div>
  );
}
