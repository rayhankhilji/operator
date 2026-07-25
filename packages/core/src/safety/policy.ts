import type { Action, Autonomy, Obstacle, PageMap, Verdict } from '../types.js';
import { findNode, describeNode } from '../perception/serialize.js';
import { ALWAYS_CONFIRM, ALWAYS_HANDOFF, checkUrl, classifyControl } from './detectors.js';

/**
 * The policy engine.
 *
 * Every action the model proposes passes through `evaluate` before it touches
 * the page. There is no second path. This is the single choke point where
 * Operator decides between doing something, asking first, and stepping aside.
 *
 * The three outcomes mean genuinely different things:
 *
 *   allow    — ordinary browsing, run it.
 *   confirm  — consequential and reversible-ish; a human says yes, then it runs.
 *   handoff  — Operator will not do this at all. The human drives the live page
 *              themselves, and Operator picks up from whatever state they leave.
 *
 * Handoff is not a failure mode. Passwords, payment details, CAPTCHAs and
 * one-time codes are things a person should enter themselves, on a page they
 * can see, and the design leans into that rather than working around it.
 */
export function evaluate(action: Action, map: PageMap, autonomy: Autonomy): Verdict {
  switch (action.type) {
    case 'navigate':
      return evaluateNavigate(action.url, autonomy);

    case 'type':
      return evaluateType(action, map, autonomy);

    case 'click':
      return evaluateClick(action, map, autonomy);

    case 'select':
    case 'setChecked': {
      const node = findNode(map, action.ref);
      if (!node) return staleRef(action.ref);
      if (node.sensitive) return handoffForSensitive(node.sensitive, action.ref, node.name);
      return { decision: 'allow' };
    }

    case 'handoff':
      return {
        decision: 'handoff',
        reason: action.reason,
        obstacle: action.obstacle ?? {
          kind: 'login',
          detail: action.reason,
          evidence: ['the agent asked for a human'],
        },
      };

    // Reading, moving and waiting change nothing outside the page.
    case 'hover':
    case 'scroll':
    case 'key':
    case 'wait':
    case 'extract':
    case 'back':
    case 'forward':
    case 'reload':
    case 'done':
    case 'fail':
      return { decision: 'allow' };

    default: {
      const exhaustive: never = action;
      return { decision: 'reject', reason: `unknown action ${JSON.stringify(exhaustive)}` };
    }
  }
}

function evaluateNavigate(url: string, autonomy: Autonomy): Verdict {
  const check = checkUrl(url, autonomy.allowedDomains);
  if (!check.allowed) {
    return { decision: 'reject', reason: check.reason ?? 'navigation blocked' };
  }
  return { decision: 'allow' };
}

function evaluateType(
  action: Extract<Action, { type: 'type' }>,
  map: PageMap,
  autonomy: Autonomy,
): Verdict {
  const node = findNode(map, action.ref);
  if (!node) return staleRef(action.ref);

  // The hard line: Operator never types into a field holding a secret.
  if (node.sensitive) {
    return handoffForSensitive(node.sensitive, action.ref, node.name);
  }

  // Typing into an ordinary field is harmless; submitting it may not be.
  if (action.submit && autonomy.confirmSideEffects) {
    return {
      decision: 'confirm',
      reason: 'this submits the form',
      summary: `Type into ${describeNode(node, action.ref)} and press Enter`,
    };
  }
  return { decision: 'allow' };
}

function evaluateClick(
  action: Extract<Action, { type: 'click' }>,
  map: PageMap,
  autonomy: Autonomy,
): Verdict {
  const node = findNode(map, action.ref);
  if (!node) return staleRef(action.ref);

  if (node.disabled) {
    return { decision: 'reject', reason: `${describeNode(node, action.ref)} is disabled` };
  }

  // Clicking into a CAPTCHA is the canonical case for stepping aside.
  const captcha = map.obstacles.find((o) => o.kind === 'captcha');
  if (captcha && touchesObstacle(node.name, ['captcha', 'robot', 'verify', 'human'])) {
    return {
      decision: 'handoff',
      reason: 'CAPTCHAs are for humans to solve, and Operator will not attempt one.',
      obstacle: captcha,
    };
  }

  const intent = classifyControl(node.name);

  if (ALWAYS_HANDOFF.has(intent)) {
    return {
      decision: 'handoff',
      reason:
        'This is a sign-in step. Operator does not enter credentials or authorise accounts — ' +
        'take the page and do it yourself, then hand it back.',
      obstacle: {
        kind: 'login',
        detail: `"${node.name}" starts an authentication flow.`,
        ref: action.ref,
        evidence: [`control labelled "${node.name}"`],
      },
    };
  }

  if (ALWAYS_CONFIRM.has(intent)) {
    return {
      decision: 'confirm',
      reason: reasonFor(intent),
      summary: `Click ${describeNode(node, action.ref)}`,
    };
  }

  if (intent === 'submit' && autonomy.confirmSideEffects) {
    return {
      decision: 'confirm',
      reason: 'this commits a form',
      summary: `Click ${describeNode(node, action.ref)}`,
    };
  }

  return { decision: 'allow' };
}

function reasonFor(intent: string): string {
  switch (intent) {
    case 'purchase':
      return 'this looks like it spends money or places an order';
    case 'destructive':
      return 'this looks like it deletes or cancels something';
    case 'broadcast':
      return 'this looks like it sends or publishes something other people will see';
    default:
      return 'this has consequences outside the page';
  }
}

function touchesObstacle(name: string, keywords: string[]): boolean {
  const lower = (name || '').toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function staleRef(ref: string): Verdict {
  return {
    decision: 'reject',
    reason: `${ref} is not on the current page — the page changed, so look again before acting`,
  };
}

function handoffForSensitive(kind: string, ref: string, name: string): Verdict {
  const label: Record<string, string> = {
    password: 'a password',
    'card-number': 'a payment card number',
    'card-cvc': 'a card security code',
    'card-expiry': 'a card expiry date',
    'government-id': 'a government ID number',
    'bank-account': 'bank account details',
    'one-time-code': 'a one-time verification code',
  };
  const what = label[kind] ?? 'a secret';

  const obstacleKind: Obstacle['kind'] =
    kind === 'password' ? 'login'
      : kind === 'one-time-code' ? 'two-factor'
        : 'payment';

  return {
    decision: 'handoff',
    reason: `That field holds ${what}. Operator never types secrets — the page is yours.`,
    obstacle: {
      kind: obstacleKind,
      detail: `The field ${name ? `"${name}"` : ref} expects ${what}.`,
      ref,
      evidence: [`field classified as ${kind}`],
    },
  };
}
