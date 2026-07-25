import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { observe } from '../src/perception/observer.js';
import type { PageMap } from '../src/types.js';
import type { ReadOnlyDriver } from '../src/perception/observer.js';
import { makeMap } from './helpers.js';

/** A driver that returns a scripted sequence of page states, then repeats. */
function driverReturning(sequence: PageMap[]): ReadOnlyDriver & { captures: number } {
  const driver = {
    captures: 0,
    async evaluate<T>(): Promise<T> {
      const map = sequence[Math.min(driver.captures, sequence.length - 1)];
      driver.captures++;
      return JSON.stringify(map) as unknown as T;
    },
  };
  return driver;
}

const button = (name: string) => ({ role: 'button' as const, name });

describe('observe', () => {
  test('returns as soon as a populated page holds still', async () => {
    const settled = makeMap([button('One'), button('Two'), button('Three'), button('Four')]);
    const driver = driverReturning([settled, settled, settled]);

    const map = await observe(driver, { settleTimeoutMs: 4000 });

    assert.equal(map.nodes.length, 4);
    assert.equal(driver.captures, 2, 'two agreeing captures should be enough');
  });

  test('keeps looking when a page claims to be ready but is nearly empty', async () => {
    // The shell of a single-page app: readyState complete, nothing rendered.
    // Two identical captures look stable, but the page is not really there.
    const shell = makeMap([]);
    const rendered = makeMap([button('Search'), button('Sign in'), button('Menu'), button('Help')]);
    const driver = driverReturning([shell, shell, shell, rendered, rendered]);

    const map = await observe(driver, { settleTimeoutMs: 4000, minimumWaitMs: 2000 });

    assert.equal(map.nodes.length, 4, 'should have waited for the real interface');
    assert.ok(driver.captures >= 4);
  });

  test('gives up on a genuinely empty page rather than hanging', async () => {
    const blank = makeMap([]);
    const driver = driverReturning([blank]);

    const started = Date.now();
    const map = await observe(driver, { settleTimeoutMs: 1200, minimumWaitMs: 600 });
    const elapsed = Date.now() - started;

    assert.equal(map.nodes.length, 0);
    assert.ok(elapsed >= 600, 'should have honoured the minimum wait');
    assert.ok(elapsed < 3000, `should not hang: took ${elapsed}ms`);
  });

  test('does not settle while the page reports itself busy', async () => {
    const loading = makeMap([button('a'), button('b'), button('c'), button('d')], { busy: true });
    const done = makeMap([button('a'), button('b'), button('c'), button('d')], { busy: false });
    const driver = driverReturning([loading, loading, done, done]);

    const map = await observe(driver, { settleTimeoutMs: 4000 });

    assert.equal(map.busy, false);
  });

  test('a page that never stops changing still returns at the deadline', async () => {
    let n = 0;
    const driver = {
      async evaluate<T>(): Promise<T> {
        n++;
        return JSON.stringify(makeMap([button(`tick ${n}`), button('b'), button('c'), button('d')])) as unknown as T;
      },
    };

    const started = Date.now();
    const map = await observe(driver, { settleTimeoutMs: 1200 });

    assert.ok(Date.now() - started >= 1200, 'should have waited out the timeout');
    assert.ok(map.nodes.length > 0);
  });

  test('surfaces a page that returns nothing usable as an error', async () => {
    const driver = { async evaluate<T>(): Promise<T> { return 'null' as unknown as T; } };
    await assert.rejects(() => observe(driver), /no usable structure/);
  });
});
