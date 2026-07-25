import type { BrowserDriver, PageMap, PageNode } from '../src/types.js';

/** Builds a `PageMap` for tests without hand-writing the whole structure. */
export function makeMap(nodes: Partial<PageNode>[], overrides: Partial<PageMap> = {}): PageMap {
  const full: PageNode[] = nodes.map((n, i) => ({
    ref: n.ref ?? `e${i}`,
    role: n.role ?? 'button',
    name: n.name ?? '',
    box: n.box ?? { x: 0, y: i * 40, w: 120, h: 32 },
    inViewport: n.inViewport ?? true,
    ...n,
  }));

  return {
    url: 'https://example.com/',
    title: 'Example',
    version: 1,
    capturedAt: Date.now(),
    viewport: { w: 1280, h: 800, scrollX: 0, scrollY: 0, scrollH: 2400 },
    nodes: full,
    roots: full.map((_, i) => i),
    text: '',
    obstacles: [],
    busy: false,
    ...overrides,
  };
}

/** Records everything the executor asks the browser to do. */
export class FakeDriver implements BrowserDriver {
  calls: string[] = [];
  /** Replies keyed by the helper method name in the injected API. */
  responses: Record<string, unknown> = {};
  currentUrl = 'https://example.com/';

  async evaluate<T>(source: string): Promise<T> {
    const match = /__operator__\[("[a-zA-Z]+")\]/.exec(source);
    const method = match ? JSON.parse(match[1]) : 'capture';
    this.calls.push(`evaluate:${method}`);
    const reply = this.responses[method] ?? { ok: true };
    return JSON.stringify(reply) as unknown as T;
  }

  async navigate(url: string): Promise<void> {
    this.calls.push(`navigate:${url}`);
    this.currentUrl = url;
  }
  async back(): Promise<void> { this.calls.push('back'); }
  async forward(): Promise<void> { this.calls.push('forward'); }
  async reload(): Promise<void> { this.calls.push('reload'); }
  async click(x: number, y: number): Promise<void> { this.calls.push(`click:${x},${y}`); }
  async moveMouse(x: number, y: number): Promise<void> { this.calls.push(`move:${x},${y}`); }
  async typeText(text: string): Promise<void> { this.calls.push(`type:${text}`); }
  async pressKey(key: string): Promise<void> { this.calls.push(`key:${key}`); }
  async scrollBy(x: number, y: number): Promise<void> { this.calls.push(`scroll:${x},${y}`); }
  async url(): Promise<string> { return this.currentUrl; }
  async screenshot(): Promise<string> { return ''; }
}
