import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { serializePageMap } from '../src/perception/serialize.js';
import { PERCEPTION_SCRIPT, captureExpression, callExpression } from '../src/perception/injected.js';
import { makeMap } from './helpers.js';

describe('the injected perception script', () => {
  // This source is a string, so the compiler never sees it. Parsing it here is
  // the only thing standing between a typo and a runtime failure in the page.
  test('parses as valid JavaScript', () => {
    assert.doesNotThrow(() => new Function(PERCEPTION_SCRIPT));
  });

  test('capture and call expressions parse too', () => {
    assert.doesNotThrow(() => new Function(captureExpression(500)));
    assert.doesNotThrow(() => new Function(callExpression('locate', ['e1'])));
  });

  test('call expressions carry their arguments safely', () => {
    const expr = callExpression('selectOption', ['e4', 'Economy "Light"']);
    assert.ok(expr.includes('"selectOption"'));
    // The quoted value must survive JSON encoding without breaking the source.
    assert.doesNotThrow(() => new Function(expr));
  });

  test('the capture expression honours the node cap', () => {
    assert.ok(captureExpression(42).includes('maxNodes: 42'));
  });
});

describe('serializePageMap', () => {
  test('gives every actionable element a quotable ref', () => {
    const map = makeMap([
      { ref: 'e1', role: 'textbox', name: 'Where from?', required: true },
      { ref: 'e2', role: 'button', name: 'Search flights' },
    ]);
    const text = serializePageMap(map);
    assert.match(text, /\[e1\] textbox "Where from\?" \(required\)/);
    assert.match(text, /\[e2\] button "Search flights"/);
  });

  test('marks sensitive fields and never shows their value', () => {
    const map = makeMap([
      { ref: 'e1', role: 'textbox', name: 'Password', sensitive: 'password', value: 'should-not-appear' },
    ]);
    const text = serializePageMap(map);
    assert.match(text, /sensitive:password/);
    assert.equal(text.includes('should-not-appear'), false);
  });

  test('shows ordinary field values', () => {
    const map = makeMap([{ ref: 'e1', role: 'textbox', name: 'From', value: 'London' }]);
    assert.match(serializePageMap(map), /value="London"/);
  });

  test('flags offscreen elements as reachable rather than hiding them', () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Load more', inViewport: false }]);
    assert.match(serializePageMap(map), /offscreen/);
  });

  test('renders text as context, without a ref', () => {
    const map = makeMap([{ ref: 'e1', role: 'text', name: 'Fares include taxes' }]);
    const text = serializePageMap(map);
    assert.match(text, /· Fares include taxes/);
    assert.equal(text.includes('[e1]'), false);
  });

  test('conveys nesting through indentation', () => {
    const map = makeMap([
      { ref: 'e0', role: 'dialog', name: 'Choose a fare', children: [1] },
      { ref: 'e1', role: 'button', name: 'Continue' },
    ]);
    map.roots = [0];
    const lines = serializePageMap(map).split('\n');
    const child = lines.find((l) => l.includes('[e1]'))!;
    assert.ok(child.startsWith('  '), 'nested control should be indented');
  });

  test('surfaces obstacles at the end', () => {
    const map = makeMap([], {
      obstacles: [{ kind: 'captcha', detail: 'A CAPTCHA is present.', evidence: [] }],
    });
    assert.match(serializePageMap(map), /! captcha: A CAPTCHA is present\./);
  });

  test('caps output so one huge page cannot exhaust the context window', () => {
    const many = Array.from({ length: 900 }, (_, i) => ({
      ref: `e${i}`, role: 'button' as const, name: `Button ${i}`,
    }));
    const text = serializePageMap(makeMap(many), { maxLines: 50 });
    assert.ok(text.split('\n').length < 70);
    assert.match(text, /further element\(s\) omitted/);
  });

  test('can restrict to the viewport', () => {
    const map = makeMap([
      { ref: 'e1', role: 'button', name: 'Visible', inViewport: true },
      { ref: 'e2', role: 'button', name: 'Below the fold', inViewport: false },
    ]);
    const text = serializePageMap(map, { viewportOnly: true });
    assert.match(text, /Visible/);
    assert.equal(text.includes('Below the fold'), false);
  });
});
