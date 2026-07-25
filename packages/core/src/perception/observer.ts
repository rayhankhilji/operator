import type { BrowserDriver, PageMap } from '../types.js';
import { captureExpression } from './injected.js';
import { delay } from '../agent/executor.js';

export interface ObserveOptions {
  /** Ceiling on elements captured, to bound both time and context size. */
  maxNodes?: number;
  /** How long to keep waiting for the page to stop changing. */
  settleTimeoutMs?: number;
}

/**
 * Captures what the page looks like *now*, once it has stopped moving.
 *
 * "Stopped moving" is the hard part. `readyState === 'complete'` is close to
 * meaningless on a modern site: the document finishes loading and then the app
 * spends another second rendering everything that matters. So rather than trust
 * a single signal, this waits for the shape of the page to hold still across
 * consecutive captures, with a hard timeout so a page that polls forever — a
 * live price ticker, a chat widget — cannot stall the run.
 */
export async function observe(driver: BrowserDriver, options: ObserveOptions = {}): Promise<PageMap> {
  const { maxNodes = 1200, settleTimeoutMs = 6000 } = options;
  const deadline = Date.now() + settleTimeoutMs;

  let previous: PageMap | null = null;
  let stableRounds = 0;

  for (;;) {
    const map = await capture(driver, maxNodes);

    if (previous && !map.busy && sameShape(previous, map)) {
      stableRounds++;
      // Two agreeing observations is enough; a third rarely changes the answer.
      if (stableRounds >= 1) return map;
    } else {
      stableRounds = 0;
    }

    if (Date.now() >= deadline) return map;

    previous = map;
    await delay(250);
  }
}

async function capture(driver: BrowserDriver, maxNodes: number): Promise<PageMap> {
  const raw = await driver.evaluate<string>(captureExpression(maxNodes));
  const map = JSON.parse(raw) as PageMap;
  // Guard against a page that navigated mid-capture and returned something odd.
  if (!map || !Array.isArray(map.nodes)) {
    throw new Error('page observation failed: the page returned no usable structure');
  }
  return map;
}

/**
 * Compares two observations for practical equivalence. Exact equality is the
 * wrong test — a clock in the footer would defeat it — so this looks at the
 * things that would change what the agent should do next.
 */
function sameShape(a: PageMap, b: PageMap): boolean {
  if (a.url !== b.url) return false;
  if (a.title !== b.title) return false;
  if (Math.abs(a.nodes.length - b.nodes.length) > 2) return false;
  if (a.obstacles.length !== b.obstacles.length) return false;

  // Interactive labels are the real signal: if the set of things you can click
  // is the same, the page is done arriving.
  const fingerprint = (m: PageMap): string =>
    m.nodes
      .filter((n) => n.role === 'button' || n.role === 'link' || n.role === 'textbox')
      .slice(0, 60)
      .map((n) => `${n.role}:${n.name}`)
      .join('|');

  return fingerprint(a) === fingerprint(b);
}
