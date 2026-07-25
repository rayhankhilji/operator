/**
 * Heuristics for reading intent off a control's label.
 *
 * These are intentionally conservative and intentionally readable. A false
 * positive costs one confirmation prompt; a false negative costs a real order,
 * a sent email, or a deleted account. The asymmetry decides every judgement
 * call in this file.
 */

export type ControlIntent =
  /** Moves money or places an order. */
  | 'purchase'
  /** Destroys data. */
  | 'destructive'
  /** Publishes or sends something other people will see. */
  | 'broadcast'
  /** Commits a form in a way that is awkward to undo. */
  | 'submit'
  /** Signs in, signs up, or authorises a third party. */
  | 'auth'
  /** Ordinary navigation and page interaction. */
  | 'benign';

interface Rule {
  intent: ControlIntent;
  pattern: RegExp;
}

/**
 * Ordered by severity: the first match wins, so `place order` is a purchase
 * even though it also matches the generic submit rule.
 */
const RULES: Rule[] = [
  {
    intent: 'purchase',
    pattern:
      /\b(place\s+(the\s+)?order|buy\s+now|complete\s+(purchase|order|payment)|pay\s+(now|\$|£|€|\d)|confirm\s+(and\s+)?pay|checkout\s+now|proceed\s+to\s+payment|book\s+(and\s+)?pay|subscribe|start\s+(free\s+)?trial|donate|send\s+money|transfer\s+funds|withdraw|deposit|place\s+bid|purchase)\b/i,
  },
  {
    intent: 'destructive',
    pattern:
      /\b(delete|remove\s+(account|permanently)|erase|destroy|wipe|deactivate|close\s+account|cancel\s+(subscription|account|booking|order)|revoke|unsubscribe|empty\s+(trash|bin)|permanently)\b/i,
  },
  {
    intent: 'broadcast',
    pattern:
      /\b(send|post|publish|tweet|reply|share|submit\s+(review|comment|post)|invite|message|email\s+(them|now)|comment)\b/i,
  },
  {
    intent: 'auth',
    pattern:
      /\b(sign\s?in|log\s?in|sign\s?up|register|create\s+account|continue\s+with\s+(google|apple|facebook|github|microsoft)|authorize|authorise|allow\s+access|grant)\b/i,
  },
  {
    intent: 'submit',
    pattern:
      /\b(submit|confirm|apply\s+now|accept|agree|i\s+agree|continue|save\s+changes|finish|complete)\b/i,
  },
];

/** Reads a control's label and returns what pressing it would probably do. */
export function classifyControl(label: string): ControlIntent {
  const text = (label || '').trim();
  if (!text) return 'benign';
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.intent;
  }
  return 'benign';
}

/** Intents that always need a human's explicit yes, whatever the autonomy setting. */
export const ALWAYS_CONFIRM: ReadonlySet<ControlIntent> = new Set<ControlIntent>([
  'purchase',
  'destructive',
  'broadcast',
]);

/**
 * Intents Operator will not perform at all, and hands to the human instead.
 * Authentication lives here because completing it means handling a credential.
 */
export const ALWAYS_HANDOFF: ReadonlySet<ControlIntent> = new Set<ControlIntent>(['auth']);

/**
 * Hosts an agent following a page's own links has no business reaching:
 * the user's own machine, their LAN, and cloud instance-metadata endpoints.
 */
const LOOPBACK_NAMES = /^(localhost|0\.0\.0\.0|::1|\[::1\])$/i;
const PRIVATE_V4_PREFIX = /^(127\.|10\.|192\.168\.|169\.254\.)/;
/** 172.16.0.0/12 — that is 172.16 through 172.31, not all of 172.x. */
const PRIVATE_V4_172 = /^172\.(1[6-9]|2\d|3[01])\./;
const INTERNAL_TLD = /\.(local|internal|localdomain|home\.arpa)$/i;

export function isPrivateHost(host: string): boolean {
  return (
    LOOPBACK_NAMES.test(host) ||
    PRIVATE_V4_PREFIX.test(host) ||
    PRIVATE_V4_172.test(host) ||
    INTERNAL_TLD.test(host) ||
    // A bare hostname with no dot is a LAN name, not a public site.
    !host.includes('.')
  );
}

export interface UrlVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks a URL against the run's domain allowlist and against a small set of
 * addresses no web agent has any business fetching.
 */
export function checkUrl(raw: string, allowedDomains: string[]): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: `"${raw}" is not a valid URL` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `refusing to open a ${url.protocol} URL` };
  }

  // Loopback and private ranges: a page can point at them, but the agent
  // reaching them would be browsing the user's own machine and network.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateHost(host)) {
    return { allowed: false, reason: `${host} is a local or private address` };
  }

  if (allowedDomains.length === 0) return { allowed: true };

  const ok = allowedDomains.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
  return ok
    ? { allowed: true }
    : { allowed: false, reason: `${host} is outside the allowed domains for this run` };
}
