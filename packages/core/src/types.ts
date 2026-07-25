/**
 * The vocabulary Operator uses to talk about a web page.
 *
 * Everything here is deliberately serialisable: a `PageMap` is produced inside
 * the page, crosses a process boundary, gets rendered into text for the model,
 * and is replayed in traces. No live DOM references ever escape the page.
 */

/** A stable handle for one element, valid for the lifetime of one `PageMap`. */
export type Ref = string;

/**
 * The semantic roles Operator distinguishes. This is a deliberately small set:
 * the model reasons better about eight kinds of thing than about eighty.
 */
export type NodeRole =
  | 'link'
  | 'button'
  | 'textbox'
  | 'combobox'
  | 'checkbox'
  | 'radio'
  | 'slider'
  | 'tab'
  | 'menuitem'
  | 'option'
  | 'heading'
  | 'text'
  | 'image'
  | 'list'
  | 'table'
  | 'dialog'
  | 'form'
  | 'iframe'
  | 'region';

/** One element in the page's semantic tree. */
export interface PageNode {
  ref: Ref;
  role: NodeRole;
  /** Accessible name: aria-label, associated <label>, placeholder, or text. */
  name: string;
  /** Current value of a form control, truncated. Never captured for secrets. */
  value?: string;
  /** Viewport-relative box in CSS pixels. */
  box: { x: number; y: number; w: number; h: number };
  /** True when the element is inside the viewport right now. */
  inViewport: boolean;
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
  required?: boolean;
  /** HTML input type, when the node is an <input>. */
  inputType?: string;
  /** Set when the field is judged to hold a secret — value is never read. */
  sensitive?: SensitiveKind;
  /** Heading level for `heading` nodes. */
  level?: number;
  /** Placement in the tree; index into `PageMap.nodes`. */
  children?: number[];
}

/** Categories of field Operator will never type into on its own. */
export type SensitiveKind =
  | 'password'
  | 'card-number'
  | 'card-cvc'
  | 'card-expiry'
  | 'government-id'
  | 'bank-account'
  | 'one-time-code';

/** Something on the page that requires a human, not a better prompt. */
export interface Obstacle {
  kind: 'captcha' | 'login' | 'payment' | 'two-factor' | 'paywall' | 'consent';
  /** Human-readable explanation of what was detected and where. */
  detail: string;
  /** The element that triggered detection, when there is a single one. */
  ref?: Ref;
  /** Evidence used for the call — surfaced in the UI so the user can judge it. */
  evidence: string[];
}

/** A complete observation of one page at one moment. */
export interface PageMap {
  url: string;
  title: string;
  /** Monotonic id; actions are validated against the map they were planned on. */
  version: number;
  capturedAt: number;
  viewport: { w: number; h: number; scrollX: number; scrollY: number; scrollH: number };
  nodes: PageNode[];
  /** Indices into `nodes` that form the top level of the tree. */
  roots: number[];
  /** Readable page text, condensed. Used for extraction and grounding. */
  text: string;
  /** Obstacles detected during capture. */
  obstacles: Obstacle[];
  /** True while the page is still settling (pending navigations, fetches). */
  busy: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Every way Operator can affect the world, as a closed union. */
export type Action =
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'click'; ref: Ref; button?: 'left' | 'right'; clickCount?: number }
  | { type: 'type'; ref: Ref; text: string; submit?: boolean; clear?: boolean }
  | { type: 'select'; ref: Ref; value: string }
  | { type: 'setChecked'; ref: Ref; checked: boolean }
  | { type: 'hover'; ref: Ref }
  | { type: 'scroll'; direction: 'up' | 'down'; amount?: number; ref?: Ref }
  | { type: 'key'; key: string }
  | { type: 'wait'; ms: number; reason?: string }
  | { type: 'extract'; query: string }
  | { type: 'handoff'; reason: string; obstacle?: Obstacle }
  | { type: 'done'; summary: string; data?: unknown }
  | { type: 'fail'; reason: string };

/** What happened when an action ran. */
export interface ActionResult {
  ok: boolean;
  /** Short description shown in the trace, e.g. `clicked "Search flights"`. */
  detail: string;
  /** Set when the action failed in a way the model should reason about. */
  error?: string;
  /** Whether the page navigated or mutated enough to need a fresh observation. */
  pageChanged: boolean;
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

/** The verdict of the policy engine for one proposed action. */
export type Verdict =
  /** Ordinary browsing. Run it. */
  | { decision: 'allow' }
  /** Consequential but permitted with a human's explicit yes. */
  | { decision: 'confirm'; reason: string; summary: string }
  /** Operator must not do this. Hand the live page to the human. */
  | { decision: 'handoff'; reason: string; obstacle: Obstacle }
  /** Structurally invalid — stale ref, unknown element. Re-observe and retry. */
  | { decision: 'reject'; reason: string };

/** How much autonomy the user has granted for this run. */
export interface Autonomy {
  /** Ask before every action that leaves a trace on the world. */
  confirmSideEffects: boolean;
  /** Domains the agent may visit. Empty means "anywhere". */
  allowedDomains: string[];
  /** Hard ceiling on steps, so a confused run cannot spin forever. */
  maxSteps: number;
  /** Hard ceiling on wall-clock time. */
  maxDurationMs: number;
}

// ---------------------------------------------------------------------------
// Run + trace
// ---------------------------------------------------------------------------

export type RunState =
  | 'idle'
  | 'observing'
  | 'thinking'
  | 'acting'
  | 'awaiting-human'
  | 'done'
  | 'failed'
  | 'cancelled';

/** One turn of the loop: what Operator saw, thought, did, and got back. */
export interface Step {
  index: number;
  /** The model's stated reason for this action, in its own words. */
  thought: string;
  action: Action;
  verdict: Verdict;
  result?: ActionResult;
  url: string;
  startedAt: number;
  endedAt?: number;
}

/** Everything the UI needs to render a live run, streamed as it happens. */
export type AgentEvent =
  | { type: 'run-started'; goal: string; runId: string }
  | { type: 'state'; state: RunState }
  | { type: 'observed'; url: string; title: string; nodeCount: number; obstacles: Obstacle[] }
  | { type: 'thinking-delta'; text: string }
  | { type: 'step-started'; step: Step }
  | { type: 'step-finished'; step: Step }
  | { type: 'confirm-required'; step: Step; summary: string; reason: string }
  | { type: 'handoff-required'; obstacle: Obstacle; reason: string }
  | { type: 'human-resumed' }
  /**
   * Where the agent is about to act, in the page's own viewport coordinates.
   * Emitted so an interface can show the pointer travelling and landing —
   * watching it work is how you build any trust in it.
   */
  | { type: 'pointer'; x: number; y: number; kind: 'move' | 'click' | 'type'; label: string }
  | { type: 'extracted'; query: string; value: unknown }
  | { type: 'run-finished'; summary: string; data?: unknown; steps: number }
  | { type: 'run-failed'; reason: string }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string };

/** The surface the agent drives. Implemented by Electron in the desktop app. */
export interface BrowserDriver {
  /** Evaluate JavaScript in the page's main world and return a JSON value. */
  evaluate<T>(source: string): Promise<T>;
  /** Navigate and wait for the document to commit. */
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  /** Dispatch a *trusted* mouse click at viewport coordinates. */
  click(x: number, y: number, opts?: { button?: 'left' | 'right'; clickCount?: number }): Promise<void>;
  /** Move the pointer, so hover states and menus behave as they do for a human. */
  moveMouse(x: number, y: number): Promise<void>;
  /** Type text as real key events, one character at a time. */
  typeText(text: string): Promise<void>;
  /** Press a named key, e.g. `Enter`, `Tab`, `Escape`. */
  pressKey(key: string): Promise<void>;
  /** Scroll the page or the element under the cursor. */
  scrollBy(x: number, y: number, at?: { x: number; y: number }): Promise<void>;
  /** Current URL. */
  url(): Promise<string>;
  /** A PNG screenshot of the viewport, base64-encoded. */
  screenshot(): Promise<string>;
}
