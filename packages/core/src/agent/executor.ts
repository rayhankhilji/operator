import type { Action, ActionResult, BrowserDriver, PageMap } from '../types.js';
import { callExpression } from '../perception/injected.js';
import { describeNode, findNode } from '../perception/serialize.js';

/**
 * Turns a validated `Action` into real input on a real page.
 *
 * The important property here is that clicks and keystrokes are *trusted* input
 * events dispatched by the browser itself, not `element.click()` or synthetic
 * `dispatchEvent` calls. Sites can tell the difference — `isTrusted` is visible
 * to any handler — and a great many of them behave differently, or not at all,
 * for synthetic events. Driving the real input pipeline is most of why Operator
 * works on pages that DOM-poking automation does not.
 */
export class Executor {
  constructor(private readonly driver: BrowserDriver) {}

  async run(action: Action, map: PageMap): Promise<ActionResult> {
    try {
      return await this.dispatch(action, map);
    } catch (error) {
      return {
        ok: false,
        detail: 'action threw',
        error: error instanceof Error ? error.message : String(error),
        pageChanged: true, // Assume the worst and re-observe.
      };
    }
  }

  private async dispatch(action: Action, map: PageMap): Promise<ActionResult> {
    switch (action.type) {
      case 'navigate': {
        await this.driver.navigate(action.url);
        return { ok: true, detail: `opened ${action.url}`, pageChanged: true };
      }

      case 'back':
        await this.driver.back();
        return { ok: true, detail: 'went back', pageChanged: true };

      case 'forward':
        await this.driver.forward();
        return { ok: true, detail: 'went forward', pageChanged: true };

      case 'reload':
        await this.driver.reload();
        return { ok: true, detail: 'reloaded', pageChanged: true };

      case 'click': {
        const spot = await this.locate(action.ref);
        if (!spot.ok) return this.miss(spot.error);

        await this.driver.moveMouse(spot.x, spot.y);
        await this.driver.click(spot.x, spot.y, {
          button: action.button,
          clickCount: action.clickCount,
        });
        return {
          ok: true,
          detail: `clicked ${this.label(map, action.ref)}`,
          pageChanged: true,
        };
      }

      case 'hover': {
        const spot = await this.locate(action.ref);
        if (!spot.ok) return this.miss(spot.error);
        await this.driver.moveMouse(spot.x, spot.y);
        await delay(180); // Let hover-intent handlers fire.
        return { ok: true, detail: `hovered ${this.label(map, action.ref)}`, pageChanged: true };
      }

      case 'type': {
        // Click the field first: many editors only initialise on real focus.
        const spot = await this.locate(action.ref);
        if (!spot.ok) return this.miss(spot.error);
        await this.driver.click(spot.x, spot.y);

        const prepared = await this.call<{ ok: boolean; error?: string }>('prepareInput', [
          action.ref,
          action.clear !== false,
        ]);
        if (!prepared.ok) return this.miss(prepared.error ?? 'could not focus the field');

        await this.driver.typeText(action.text);
        if (action.submit) {
          await delay(120);
          await this.driver.pressKey('Enter');
        }

        const label = this.label(map, action.ref);
        return {
          ok: true,
          detail: `typed ${JSON.stringify(truncate(action.text, 60))} into ${label}` +
            (action.submit ? ' and pressed Enter' : ''),
          pageChanged: true,
        };
      }

      case 'select': {
        const res = await this.call<{ ok: boolean; error?: string; chose?: string; options?: string[] }>(
          'selectOption',
          [action.ref, action.value],
        );
        if (!res.ok) {
          const hint = res.options?.length
            ? ` Available options: ${res.options.slice(0, 15).join(', ')}`
            : '';
          return { ok: false, detail: 'select failed', error: (res.error ?? 'failed') + hint, pageChanged: false };
        }
        return {
          ok: true,
          detail: `chose ${JSON.stringify(res.chose ?? action.value)} in ${this.label(map, action.ref)}`,
          pageChanged: true,
        };
      }

      case 'setChecked': {
        const node = findNode(map, action.ref);
        if (node && node.checked === action.checked) {
          return {
            ok: true,
            detail: `${this.label(map, action.ref)} was already ${action.checked ? 'checked' : 'unchecked'}`,
            pageChanged: false,
          };
        }
        const spot = await this.locate(action.ref);
        if (!spot.ok) return this.miss(spot.error);
        await this.driver.click(spot.x, spot.y);
        return {
          ok: true,
          detail: `${action.checked ? 'checked' : 'unchecked'} ${this.label(map, action.ref)}`,
          pageChanged: true,
        };
      }

      case 'scroll': {
        const amount = action.amount ?? Math.round(map.viewport.h * 0.85);
        const dy = action.direction === 'up' ? -amount : amount;
        await this.driver.scrollBy(0, dy);
        await delay(220); // Lazy-loading pages need a moment to fill in.
        return { ok: true, detail: `scrolled ${action.direction} ${Math.abs(dy)}px`, pageChanged: true };
      }

      case 'key':
        await this.driver.pressKey(action.key);
        return { ok: true, detail: `pressed ${action.key}`, pageChanged: true };

      case 'wait':
        await delay(action.ms);
        return { ok: true, detail: `waited ${action.ms}ms`, pageChanged: true };

      // These are resolved by the loop, not by the page.
      case 'extract':
      case 'handoff':
      case 'done':
      case 'fail':
        return { ok: true, detail: action.type, pageChanged: false };
    }
  }

  /** Scroll the target into view and get a click point that is not covered. */
  private async locate(
    ref: string,
  ): Promise<{ ok: true; x: number; y: number } | { ok: false; error: string }> {
    const res = await this.call<{ ok: boolean; x?: number; y?: number; error?: string }>('locate', [ref]);
    if (!res.ok || res.x === undefined || res.y === undefined) {
      return { ok: false, error: res.error ?? `could not locate ${ref}` };
    }
    // Scrolling moved things; give the page a frame to settle before clicking.
    await delay(90);
    return { ok: true, x: res.x, y: res.y };
  }

  private async call<T>(method: string, args: unknown[]): Promise<T> {
    const raw = await this.driver.evaluate<string>(callExpression(method, args));
    return JSON.parse(raw) as T;
  }

  private label(map: PageMap, ref: string): string {
    return describeNode(findNode(map, ref), ref);
  }

  private miss(error: string): ActionResult {
    return { ok: false, detail: 'could not act on that element', error, pageChanged: true };
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
