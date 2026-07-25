import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react';
import type { WebviewTag } from 'electron';
import type { AgentEvent } from '@operator/core';

import { Timeline } from './components/Timeline.js';
import { Interrupt } from './components/Interrupt.js';
import { Settings } from './components/Settings.js';
import { ArrowLeft, ArrowRight, Gear, Panel, Reload } from './components/icons.js';
import {
  initialRun, isBusy, looksLikeUrl, reduce, stateLabel, toUrl,
  type RunModel,
} from './state.js';
import type { Settings as SettingsModel } from '../../preload/index.js';

const EXAMPLES = [
  'Find the cheapest direct flight from London to Lisbon next month',
  'What does this site charge for the team plan?',
  'Add the top-rated stand mixer under £200 to my basket',
  'Summarise the last three posts on this blog',
];

export function App(): JSX.Element {
  const [run, dispatch] = useReducer(reduce, initialRun);
  const [settings, setSettings] = useState<SettingsModel | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [keyEncrypted, setKeyEncrypted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPanel, setShowPanel] = useState(true);

  const [input, setInput] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [nav, setNav] = useState({ back: false, forward: false });

  /**
   * The guest view is created lazily, so the welcome screen can own the window
   * until there is something to show. `viewSrc` doubles as the mount switch:
   * null means no browser yet.
   */
  const [viewSrc, setViewSrc] = useState<string | null>(null);
  /** True once Chromium has built the guest and the main process has its id. */
  const [attached, setAttached] = useState(false);
  /** A goal typed before the browser existed, run as soon as it does. */
  const [pendingGoal, setPendingGoal] = useState<string | null>(null);

  const view = useRef<WebviewTag | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const intent = useRef<HTMLInputElement | null>(null);
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

  // Bind to the guest view once Chromium has actually created it.
  useEffect(() => {
    const element = view.current;
    if (!element) return;

    const onReady = (): void => {
      void window.operator.attachView(element.getWebContentsId()).then(() => setAttached(true));
      syncNav();
    };
    const syncNav = (): void => {
      setUrl(element.getURL());
      setNav({ back: element.canGoBack(), forward: element.canGoForward() });
    };
    const onStart = (): void => setLoading(true);
    const onStop = (): void => { setLoading(false); syncNav(); };

    element.addEventListener('dom-ready', onReady);
    element.addEventListener('did-start-loading', onStart);
    element.addEventListener('did-stop-loading', onStop);
    element.addEventListener('did-navigate', syncNav);
    element.addEventListener('did-navigate-in-page', syncNav);

    return () => {
      element.removeEventListener('dom-ready', onReady);
      element.removeEventListener('did-start-loading', onStart);
      element.removeEventListener('did-stop-loading', onStop);
      element.removeEventListener('did-navigate', syncNav);
      element.removeEventListener('did-navigate-in-page', syncNav);
    };
  }, [started]);

  /**
   * The shortcuts a browser is expected to have. These are handled here rather
   * than through an Electron application menu because the guest page has focus
   * most of the time, and a renderer-level listener still fires when the user
   * is looking at the page rather than at our chrome.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;

      switch (event.key) {
        case 'l':
          event.preventDefault();
          intent.current?.focus();
          intent.current?.select();
          break;
        case ',':
          event.preventDefault();
          setShowSettings(true);
          break;
        case 'r':
          event.preventDefault();
          view.current?.reload();
          break;
        case '[':
          event.preventDefault();
          if (view.current?.canGoBack()) view.current.goBack();
          break;
        case ']':
          event.preventDefault();
          if (view.current?.canGoForward()) view.current.goForward();
          break;
        case '\\':
          event.preventDefault();
          setShowPanel((v) => !v);
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Follow the trace as it grows, so the newest step is always in sight.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [run.steps.length, run.streaming, run.interrupt, run.outcome]);

  // -- actions --------------------------------------------------------------

  const go = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setInput('');

    if (looksLikeUrl(text)) {
      const target = toUrl(text);
      setUrl(target);
      // On the first navigation the guest does not exist yet, so `src` is what
      // mounts it. Afterwards it is already there and must be told to move.
      if (view.current) void window.operator.navigate(target);
      else setViewSrc(target);
      return;
    }

    if (!hasApiKey) { setShowSettings(true); return; }

    if (!attached) {
      // First task of the session: mount the browser, then run once Chromium
      // has actually created the guest and handed us its id.
      setViewSrc((current) => current ?? settings?.homeUrl ?? 'about:blank');
      setPendingGoal(text);
      return;
    }

    const startUrl = view.current?.getURL();
    void window.operator.run(
      text,
      startUrl && startUrl !== 'about:blank' ? startUrl : settings?.homeUrl,
    );
  }, [hasApiKey, attached, settings?.homeUrl]);

  // Release a goal that was queued before the browser was ready.
  useEffect(() => {
    if (!attached || !pendingGoal) return;
    const goal = pendingGoal;
    setPendingGoal(null);
    const startUrl = view.current?.getURL();
    void window.operator.run(
      goal,
      startUrl && startUrl !== 'about:blank' ? startUrl : settings?.homeUrl,
    );
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
  const handoff = run.interrupt?.kind === 'handoff';
  const tone = toneFor(run.state);

  const mode = useMemo(
    () => (input.trim() && looksLikeUrl(input) ? 'url' : 'goal'),
    [input],
  );

  return (
    <div className="shell">
      <header className="titlebar">
        <div className="wordmark">
          <span className="mark" data-live={busy} />
          Operator
        </div>

        <div className="navgroup">
          <button
            className="iconbtn"
            disabled={!nav.back}
            onClick={() => view.current?.goBack()}
            title="Back"
          ><ArrowLeft /></button>
          <button
            className="iconbtn"
            disabled={!nav.forward}
            onClick={() => view.current?.goForward()}
            title="Forward"
          ><ArrowRight /></button>
          <button
            className="iconbtn"
            onClick={() => view.current?.reload()}
            title="Reload"
          ><Reload /></button>
        </div>

        <div className="intent">
          <span className="intent-mode" data-mode={mode}>
            {mode === 'url' ? 'Go' : 'Task'}
          </span>
          <input
            ref={intent}
            value={input}
            placeholder={
              busy
                ? 'Operator is working — press Escape to stop'
                : 'Type an address, or tell Operator what to do'
            }
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(input);
              if (e.key === 'Escape') { setInput(''); if (busy) void window.operator.cancel(); }
            }}
          />
          {input.trim() && <span className="intent-hint">⏎</span>}
        </div>

        <div className="pill" data-tone={tone}>
          <span className="dot" />
          {loading && run.state === 'idle' ? 'Loading' : stateLabel(run.state)}
        </div>

        {busy && (
          <button className="stop" onClick={() => void window.operator.cancel()}>Stop</button>
        )}

        <button
          className={`iconbtn ${showPanel ? 'active' : ''}`}
          onClick={() => setShowPanel((v) => !v)}
          title="Toggle the run panel"
        ><Panel /></button>

        <button className="iconbtn" onClick={() => setShowSettings(true)} title="Settings">
          <Gear />
        </button>
      </header>

      <div className="body" data-panel={showPanel ? 'shown' : 'hidden'}>
        <div className="stage" data-handoff={handoff}>
          {started ? (
            <webview
              ref={view as never}
              src={viewSrc ?? 'about:blank'}
              partition="persist:operator"
              allowpopups
            />
          ) : (
            <Welcome onPick={(text) => { setInput(text); go(text); }} />
          )}
        </div>

        {showPanel && (
          <aside className="panel">
            <div className="panel-head">
              <span className="panel-label">{run.goal ? 'Task' : 'No task running'}</span>
              <span className="panel-goal">
                {run.goal || 'Type an instruction above and Operator will work through it here.'}
              </span>
            </div>

            <div className="panel-scroll" ref={scroller}>
              <RunView run={run} />
            </div>

            <div className="panel-foot">
              <span>{truncate(url || 'about:blank', 40)}</span>
              <span>{run.steps.length ? `${run.steps.length} steps` : ''}</span>
            </div>
          </aside>
        )}
      </div>

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

function RunView({ run }: { run: RunModel }): JSX.Element {
  const empty = run.steps.length === 0 && !run.interrupt && !run.outcome && run.state === 'idle';

  if (empty) {
    return (
      <div className="empty-state">
        Operator reads the page the way a person does — headings, buttons, fields and
        all — then decides one action at a time.
        <br /><br />
        Every step it takes appears here.
      </div>
    );
  }

  return (
    <>
      {run.interrupt && (
        <Interrupt
          interrupt={run.interrupt}
          onConfirm={(approved) => void window.operator.confirm(approved)}
          onResume={() => void window.operator.resume()}
        />
      )}

      {run.outcome && (
        <div className="outcome" data-kind={run.outcome.kind}>{run.outcome.message}</div>
      )}

      {run.findings.length > 0 && (
        <div className="findings">
          {run.findings.map((f, i) => (
            <div className="finding" key={i}>
              <span className="finding-key">{f.query}</span>
              <span className="finding-value">{format(f.value)}</span>
            </div>
          ))}
        </div>
      )}

      <Timeline
        steps={run.steps}
        streaming={run.streaming}
        thinking={run.state === 'thinking' || run.state === 'observing'}
      />
    </>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }): JSX.Element {
  return (
    <div className="stage-empty">
      <h1>A browser that drives itself.</h1>
      <p>
        Give Operator a goal instead of a URL. It finds the site, reads the page,
        fills the forms and works through the steps — and stops to ask you whenever
        the next move is genuinely yours.
      </p>
      <div className="examples">
        {EXAMPLES.map((example) => (
          <button className="example" key={example} onClick={() => onPick(example)}>
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

function toneFor(state: RunModel['state']): string {
  if (state === 'awaiting-human') return 'human';
  if (state === 'done') return 'done';
  if (state === 'failed' || state === 'cancelled') return 'failed';
  if (isBusy(state)) return 'busy';
  return 'idle';
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function truncate(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}
