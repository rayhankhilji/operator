import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { evaluate } from '../src/safety/policy.js';
import { classifyControl, checkUrl } from '../src/safety/detectors.js';
import { DEFAULT_AUTONOMY } from '../src/agent/loop.js';
import { makeMap } from './helpers.js';

const autonomy = { ...DEFAULT_AUTONOMY };

describe('classifyControl', () => {
  test('recognises spending money', () => {
    for (const label of ['Place order', 'Buy now', 'Confirm and pay', 'Complete purchase', 'Subscribe']) {
      assert.equal(classifyControl(label), 'purchase', label);
    }
  });

  test('recognises destruction', () => {
    for (const label of ['Delete account', 'Cancel subscription', 'Permanently remove']) {
      assert.equal(classifyControl(label), 'destructive', label);
    }
  });

  test('recognises authentication', () => {
    for (const label of ['Sign in', 'Log In', 'Continue with Google', 'Create account']) {
      assert.equal(classifyControl(label), 'auth', label);
    }
  });

  test('leaves ordinary navigation alone', () => {
    for (const label of ['Next page', 'Search flights', 'View details', 'Filter results']) {
      assert.equal(classifyControl(label), 'benign', label);
    }
  });

  test('severity wins over generality', () => {
    // "Place order" also matches the generic submit rule; purchase must win.
    assert.equal(classifyControl('Place order — confirm'), 'purchase');
  });
});

describe('checkUrl', () => {
  test('blocks non-http schemes', () => {
    assert.equal(checkUrl('file:///etc/passwd', []).allowed, false);
    assert.equal(checkUrl('javascript:alert(1)', []).allowed, false);
  });

  test('blocks loopback, LAN, and instance-metadata addresses', () => {
    for (const url of [
      'http://localhost:8080/',
      'http://127.0.0.1/',
      'http://192.168.1.1/',
      'http://10.0.0.5/',
      'http://172.16.4.4/',
      'http://172.31.255.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://router.local/',
      'http://intranet/',
    ]) {
      assert.equal(checkUrl(url, []).allowed, false, url);
    }
  });

  test('does not over-block public addresses that merely look private', () => {
    // 172.32.x is public; only 172.16–172.31 is the private range.
    assert.equal(checkUrl('http://172.32.0.1/', []).allowed, true);
    assert.equal(checkUrl('https://example.com/', []).allowed, true);
  });

  test('honours the allowlist, including subdomains', () => {
    assert.equal(checkUrl('https://www.kayak.com/flights', ['kayak.com']).allowed, true);
    assert.equal(checkUrl('https://kayak.com/', ['kayak.com']).allowed, true);
    assert.equal(checkUrl('https://evil.com/', ['kayak.com']).allowed, false);
  });

  test('an empty allowlist means anywhere public', () => {
    assert.equal(checkUrl('https://example.org/', []).allowed, true);
  });
});

describe('policy', () => {
  test('never types into a password field', () => {
    const map = makeMap([{ ref: 'e1', role: 'textbox', name: 'Password', sensitive: 'password' }]);
    const verdict = evaluate({ type: 'type', ref: 'e1', text: 'hunter2' }, map, autonomy);
    assert.equal(verdict.decision, 'handoff');
  });

  test('never types into a card number field', () => {
    const map = makeMap([{ ref: 'e1', role: 'textbox', name: 'Card number', sensitive: 'card-number' }]);
    const verdict = evaluate({ type: 'type', ref: 'e1', text: '4111111111111111' }, map, autonomy);
    assert.equal(verdict.decision, 'handoff');
    if (verdict.decision === 'handoff') assert.equal(verdict.obstacle.kind, 'payment');
  });

  test('hands off sign-in rather than confirming it', () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Sign in' }]);
    const verdict = evaluate({ type: 'click', ref: 'e1' }, map, autonomy);
    assert.equal(verdict.decision, 'handoff');
  });

  test('asks before spending money', () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Place order' }]);
    const verdict = evaluate({ type: 'click', ref: 'e1' }, map, autonomy);
    assert.equal(verdict.decision, 'confirm');
  });

  test('asks before deleting', () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Delete account' }]);
    assert.equal(evaluate({ type: 'click', ref: 'e1' }, map, autonomy).decision, 'confirm');
  });

  test('allows ordinary clicks', () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Search flights' }]);
    assert.equal(evaluate({ type: 'click', ref: 'e1' }, map, autonomy).decision, 'allow');
  });

  test('rejects a ref that is not on the page', () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Search' }]);
    assert.equal(evaluate({ type: 'click', ref: 'e99' }, map, autonomy).decision, 'reject');
  });

  test('rejects a disabled control', () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Continue', disabled: true }]);
    assert.equal(evaluate({ type: 'click', ref: 'e1' }, map, autonomy).decision, 'reject');
  });

  test('hands off a CAPTCHA checkbox', () => {
    const map = makeMap(
      [{ ref: 'e1', role: 'checkbox', name: "I'm not a robot" }],
      {
        obstacles: [
          { kind: 'captcha', detail: 'reCAPTCHA present', evidence: ['iframe: recaptcha'] },
        ],
      },
    );
    assert.equal(evaluate({ type: 'click', ref: 'e1' }, map, autonomy).decision, 'handoff');
  });

  test('only confirms plain submits when the user asked to be asked', () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Continue' }]);
    assert.equal(evaluate({ type: 'click', ref: 'e1' }, map, autonomy).decision, 'allow');
    assert.equal(
      evaluate({ type: 'click', ref: 'e1' }, map, { ...autonomy, confirmSideEffects: true }).decision,
      'confirm',
    );
  });

  test('blocks navigation outside the allowlist', () => {
    const map = makeMap([]);
    const scoped = { ...autonomy, allowedDomains: ['example.com'] };
    assert.equal(evaluate({ type: 'navigate', url: 'https://elsewhere.com' }, map, scoped).decision, 'reject');
    assert.equal(evaluate({ type: 'navigate', url: 'https://example.com/a' }, map, scoped).decision, 'allow');
  });
});
