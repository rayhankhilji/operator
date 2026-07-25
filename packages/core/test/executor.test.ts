import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { Executor } from '../src/agent/executor.js';
import { FakeDriver, makeMap } from './helpers.js';

describe('Executor', () => {
  test('clicks by moving the pointer first, like a person would', async () => {
    const driver = new FakeDriver();
    driver.responses.locate = { ok: true, x: 100, y: 200 };
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Search flights' }]);

    const result = await new Executor(driver).run({ type: 'click', ref: 'e1' }, map);

    assert.equal(result.ok, true);
    assert.match(result.detail, /clicked button "Search flights"/);
    assert.deepEqual(
      driver.calls.filter((c) => c.startsWith('move') || c.startsWith('click')),
      ['move:100,200', 'click:100,200'],
    );
  });

  test('reports a covered element instead of clicking through it', async () => {
    const driver = new FakeDriver();
    driver.responses.locate = { ok: false, error: 'element e1 is covered by <div class="modal">' };
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Buy' }]);

    const result = await new Executor(driver).run({ type: 'click', ref: 'e1' }, map);

    assert.equal(result.ok, false);
    assert.match(result.error!, /covered by/);
    assert.equal(driver.calls.some((c) => c.startsWith('click:')), false);
  });

  test('typing focuses, clears, types real keys, and can submit', async () => {
    const driver = new FakeDriver();
    driver.responses.locate = { ok: true, x: 10, y: 20 };
    driver.responses.prepareInput = { ok: true };
    const map = makeMap([{ ref: 'e1', role: 'textbox', name: 'Where to?' }]);

    const result = await new Executor(driver).run(
      { type: 'type', ref: 'e1', text: 'Lisbon', submit: true },
      map,
    );

    assert.equal(result.ok, true);
    assert.ok(driver.calls.includes('evaluate:prepareInput'));
    assert.ok(driver.calls.includes('type:Lisbon'));
    assert.ok(driver.calls.includes('key:Enter'));
    assert.match(result.detail, /pressed Enter/);
  });

  test('a failed select tells the model what the options actually are', async () => {
    const driver = new FakeDriver();
    driver.responses.selectOption = {
      ok: false,
      error: 'no option matched "Buisness"',
      options: ['Economy', 'Premium', 'Business'],
    };
    const map = makeMap([{ ref: 'e1', role: 'combobox', name: 'Cabin' }]);

    const result = await new Executor(driver).run({ type: 'select', ref: 'e1', value: 'Buisness' }, map);

    assert.equal(result.ok, false);
    assert.match(result.error!, /Available options: Economy, Premium, Business/);
  });

  test('checking a box that is already checked does nothing', async () => {
    const driver = new FakeDriver();
    const map = makeMap([{ ref: 'e1', role: 'checkbox', name: 'Direct flights', checked: true }]);

    const result = await new Executor(driver).run({ type: 'setChecked', ref: 'e1', checked: true }, map);

    assert.equal(result.ok, true);
    assert.equal(result.pageChanged, false);
    assert.equal(driver.calls.some((c) => c.startsWith('click:')), false);
  });

  test('scroll defaults to roughly one viewport', async () => {
    const driver = new FakeDriver();
    const map = makeMap([]);
    await new Executor(driver).run({ type: 'scroll', direction: 'down' }, map);
    assert.ok(driver.calls.some((c) => c === 'scroll:0,680'));
  });

  test('a thrown driver error becomes a result, not a crash', async () => {
    const driver = new FakeDriver();
    driver.evaluate = async () => { throw new Error('page detached'); };
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Go' }]);

    const result = await new Executor(driver).run({ type: 'click', ref: 'e1' }, map);

    assert.equal(result.ok, false);
    assert.match(result.error!, /page detached/);
    assert.equal(result.pageChanged, true, 'should re-observe after an unknown failure');
  });
});
