import type { WebContents } from 'electron';
import type { BrowserDriver } from '@operator/core';

/**
 * A `BrowserDriver` backed by real Chromium.
 *
 * The whole point of this class is the difference between `element.click()` and
 * a mouse event that came out of the browser's own input pipeline. The former
 * is trivially detectable — handlers see `event.isTrusted === false` — and a
 * large number of real sites either ignore it or treat it as a bot signal. The
 * latter is indistinguishable from a person, because it *is* the same code path
 * a person's mouse goes through.
 *
 * Everything here therefore goes via `sendInputEvent`, and JavaScript execution
 * is reserved for reading the page and for the few operations that have no
 * input-event equivalent.
 */
export class ElectronDriver implements BrowserDriver {
  constructor(private readonly contents: WebContents) {}

  private get wc(): WebContents {
    if (this.contents.isDestroyed()) {
      throw new Error('the browser view was closed');
    }
    return this.contents;
  }

  async evaluate<T>(source: string): Promise<T> {
    // `true` marks this as a user gesture, which some APIs (fullscreen, audio
    // playback, clipboard) refuse to run without.
    return (await this.wc.executeJavaScript(source, true)) as T;
  }

  async navigate(url: string): Promise<void> {
    const wc = this.wc;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        // A slow page is not a failed page: resolve and let observation decide.
        resolve();
      }, 30_000);

      const onDone = (): void => { cleanup(); resolve(); };
      const onFail = (_e: unknown, code: number, description: string, _url: string, isMainFrame: boolean): void => {
        if (!isMainFrame) return;
        // -3 is ERR_ABORTED, which fires on ordinary redirects and downloads.
        if (code === -3) { cleanup(); resolve(); return; }
        cleanup();
        reject(new Error(`could not load ${url}: ${description}`));
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        wc.off('did-finish-load', onDone);
        wc.off('did-fail-load', onFail as never);
      };

      wc.once('did-finish-load', onDone);
      wc.on('did-fail-load', onFail as never);

      wc.loadURL(url).catch((error) => { cleanup(); reject(error); });
    });
  }

  async back(): Promise<void> {
    if (this.wc.navigationHistory.canGoBack()) {
      this.wc.navigationHistory.goBack();
      await this.waitForLoad();
    }
  }

  async forward(): Promise<void> {
    if (this.wc.navigationHistory.canGoForward()) {
      this.wc.navigationHistory.goForward();
      await this.waitForLoad();
    }
  }

  async reload(): Promise<void> {
    this.wc.reload();
    await this.waitForLoad();
  }

  async moveMouse(x: number, y: number): Promise<void> {
    this.wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    await sleep(16); // One frame, so hover styles apply before anything else.
  }

  async click(
    x: number,
    y: number,
    opts: { button?: 'left' | 'right'; clickCount?: number } = {},
  ): Promise<void> {
    const button = opts.button ?? 'left';
    const clickCount = opts.clickCount ?? 1;
    const point = { x: Math.round(x), y: Math.round(y) };

    for (let i = 1; i <= clickCount; i++) {
      this.wc.sendInputEvent({ type: 'mouseDown', ...point, button, clickCount: i });
      await sleep(24); // A human's press is not instantaneous.
      this.wc.sendInputEvent({ type: 'mouseUp', ...point, button, clickCount: i });
      if (i < clickCount) await sleep(40);
    }
    await sleep(60);
  }

  async typeText(text: string): Promise<void> {
    for (const character of text) {
      // keyDown/char/keyUp is the full sequence. Frameworks that listen for
      // keydown (autocompletes, input masks, "type to search" widgets) need the
      // first; the actual insertion comes from the char event.
      this.wc.sendInputEvent({ type: 'keyDown', keyCode: character });
      this.wc.sendInputEvent({ type: 'char', keyCode: character });
      this.wc.sendInputEvent({ type: 'keyUp', keyCode: character });
      await sleep(TYPING_DELAY_MS);
    }
  }

  async pressKey(key: string): Promise<void> {
    this.wc.sendInputEvent({ type: 'keyDown', keyCode: key });
    if (PRINTABLE_KEYS.has(key)) {
      this.wc.sendInputEvent({ type: 'char', keyCode: key });
    }
    this.wc.sendInputEvent({ type: 'keyUp', keyCode: key });
    await sleep(60);
  }

  async scrollBy(x: number, y: number, at?: { x: number; y: number }): Promise<void> {
    const point = at ?? { x: 400, y: 400 };
    // Chromium expects wheel deltas in the direction the *content* moves, which
    // is the opposite of the direction the user scrolls.
    this.wc.sendInputEvent({
      type: 'mouseWheel',
      x: Math.round(point.x),
      y: Math.round(point.y),
      deltaX: -Math.round(x),
      deltaY: -Math.round(y),
      canScroll: true,
    } as Parameters<WebContents['sendInputEvent']>[0]);
    await sleep(120);
  }

  async url(): Promise<string> {
    return this.wc.getURL();
  }

  async screenshot(): Promise<string> {
    const image = await this.wc.capturePage();
    return image.toPNG().toString('base64');
  }

  private waitForLoad(timeoutMs = 15_000): Promise<void> {
    const wc = this.wc;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(finish, timeoutMs);
      function finish(): void {
        clearTimeout(timer);
        wc.off('did-finish-load', finish);
        resolve();
      }
      wc.once('did-finish-load', finish);
    });
  }
}

/**
 * Fast enough not to be tedious, slow enough that debounced autocompletes and
 * React-controlled inputs keep up. Typing instantly is a common way to end up
 * with a field that shows the last character only.
 */
const TYPING_DELAY_MS = 14;

const PRINTABLE_KEYS = new Set([' ', 'Space']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
