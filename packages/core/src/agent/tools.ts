import type Anthropic from '@anthropic-ai/sdk';
import type { Action } from '../types.js';

/**
 * The action space, as tools.
 *
 * These mirror the `Action` union exactly. Keeping the two in step by hand is
 * a small cost; the alternative — a schema generator — buys nothing here and
 * makes the descriptions, which are the part that actually steers the model,
 * harder to write well.
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'navigate',
    description:
      'Load a URL. Use this to start a task or to jump straight to a known page. ' +
      'Prefer clicking a real link when one exists — sites often depend on state ' +
      'that a direct URL skips.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL including the scheme.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'click',
    description:
      'Click an element by its ref. The click is a real mouse event at the ' +
      'element\'s centre, so hover menus, drag handles and JS-only widgets all ' +
      'behave as they do for a person.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'A ref from the current page map, e.g. "e42".' },
        why: { type: 'string', description: 'One short line on what you expect this to do.' },
        button: { type: 'string', enum: ['left', 'right'] },
        clickCount: { type: 'number', description: '2 for a double-click.' },
      },
      required: ['ref', 'why'],
    },
  },
  {
    name: 'type',
    description:
      'Focus a field and type into it with real key events. Set submit to press ' +
      'Enter afterwards. Never use this for passwords, card numbers, security ' +
      'codes or one-time codes — those fields are marked sensitive, and the ' +
      'right move there is handoff.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        text: { type: 'string' },
        why: { type: 'string' },
        clear: { type: 'boolean', description: 'Clear the field first. Defaults to true.' },
        submit: { type: 'boolean', description: 'Press Enter after typing.' },
      },
      required: ['ref', 'text', 'why'],
    },
  },
  {
    name: 'select',
    description: 'Choose an option in a <select> by its value or its visible label.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        value: { type: 'string' },
        why: { type: 'string' },
      },
      required: ['ref', 'value', 'why'],
    },
  },
  {
    name: 'set_checked',
    description: 'Check or uncheck a checkbox or radio button.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        checked: { type: 'boolean' },
        why: { type: 'string' },
      },
      required: ['ref', 'checked', 'why'],
    },
  },
  {
    name: 'hover',
    description: 'Move the pointer onto an element, to open a hover menu or reveal a tooltip.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' }, why: { type: 'string' } },
      required: ['ref', 'why'],
    },
  },
  {
    name: 'scroll',
    description:
      'Scroll the page. Elements marked offscreen are real and reachable — scroll ' +
      'to them rather than assuming they do not exist.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number', description: 'Pixels. Defaults to about one viewport.' },
        why: { type: 'string' },
      },
      required: ['direction', 'why'],
    },
  },
  {
    name: 'press_key',
    description: 'Press a single key such as Enter, Tab, Escape, ArrowDown, or PageDown.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' }, why: { type: 'string' } },
      required: ['key', 'why'],
    },
  },
  {
    name: 'go_back',
    description: 'Go back in history. Useful after a dead end.',
    input_schema: { type: 'object', properties: { why: { type: 'string' } }, required: ['why'] },
  },
  {
    name: 'wait',
    description:
      'Wait for the page to settle. Use after an action that triggers a load or a ' +
      'network request. Do not use it as a substitute for reading the page again.',
    input_schema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds, 250 to 10000.' },
        why: { type: 'string' },
      },
      required: ['ms', 'why'],
    },
  },
  {
    name: 'extract',
    description:
      'Record a finding from the current page into the run\'s results — a price, ' +
      'a flight number, a confirmation code. Use it as you go, not just at the end: ' +
      'pages change under you and the value may be gone by the time you finish.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What this value is, e.g. "cheapest fare".' },
        value: { description: 'The value itself. Any JSON shape.' },
        ref: {
          type: 'string',
          description:
            'The ref of the element you read this from, when there is one. It lets ' +
            'the person click the fact and be shown exactly where it came from, so ' +
            'give it whenever the value is visible in a specific element.',
        },
      },
      required: ['query', 'value'],
    },
  },
  {
    name: 'handoff',
    description:
      'Stop and give the live page to the person. Use this the moment the task ' +
      'needs a CAPTCHA solved, a password or card number entered, a one-time code, ' +
      'or any judgement that is genuinely theirs to make. This is a normal, ' +
      'expected move — not a failure. Say precisely what they need to do. They ' +
      'will hand the page back and you continue from wherever they left it.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'What you need them to do, in one or two plain sentences.',
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'done',
    description:
      'The goal is achieved. Summarise what happened and what you found. Only call ' +
      'this when the outcome is actually visible on the page — not when you believe ' +
      'it probably worked.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        data: { description: 'Structured result, if the goal asked for one.' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'fail',
    description:
      'The goal cannot be achieved. Say what blocked you and what you tried. Prefer ' +
      'handoff when a person could unblock it.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
];

export interface ParsedCall {
  action: Action;
  /** The model's stated reason, surfaced verbatim in the trace. */
  thought: string;
}

/** Turns a tool call from the model into a validated `Action`. */
export function parseToolCall(name: string, rawInput: unknown): ParsedCall {
  const input = (rawInput ?? {}) as Record<string, any>;
  const thought = typeof input.why === 'string' ? input.why : '';

  switch (name) {
    case 'navigate':
      return { action: { type: 'navigate', url: String(input.url ?? '') }, thought: thought || `Open ${input.url}` };
    case 'click':
      return {
        action: {
          type: 'click',
          ref: String(input.ref ?? ''),
          button: input.button === 'right' ? 'right' : 'left',
          clickCount: Number(input.clickCount) === 2 ? 2 : 1,
        },
        thought,
      };
    case 'type':
      return {
        action: {
          type: 'type',
          ref: String(input.ref ?? ''),
          text: String(input.text ?? ''),
          clear: input.clear !== false,
          submit: input.submit === true,
        },
        thought,
      };
    case 'select':
      return {
        action: { type: 'select', ref: String(input.ref ?? ''), value: String(input.value ?? '') },
        thought,
      };
    case 'set_checked':
      return {
        action: { type: 'setChecked', ref: String(input.ref ?? ''), checked: input.checked === true },
        thought,
      };
    case 'hover':
      return { action: { type: 'hover', ref: String(input.ref ?? '') }, thought };
    case 'scroll':
      return {
        action: {
          type: 'scroll',
          direction: input.direction === 'up' ? 'up' : 'down',
          amount: typeof input.amount === 'number' ? input.amount : undefined,
        },
        thought,
      };
    case 'press_key':
      return { action: { type: 'key', key: String(input.key ?? 'Enter') }, thought };
    case 'go_back':
      return { action: { type: 'back' }, thought };
    case 'wait':
      return {
        action: {
          type: 'wait',
          ms: clamp(Number(input.ms) || 1000, 250, 10_000),
          reason: thought,
        },
        thought,
      };
    case 'extract':
      return {
        action: { type: 'extract', query: String(input.query ?? '') },
        thought: thought || `Record ${input.query}`,
      };
    case 'handoff':
      return {
        action: { type: 'handoff', reason: String(input.reason ?? 'a person is needed here') },
        thought: String(input.reason ?? ''),
      };
    case 'done':
      return {
        action: { type: 'done', summary: String(input.summary ?? 'Done.'), data: input.data },
        thought: thought || 'Goal reached.',
      };
    case 'fail':
      return {
        action: { type: 'fail', reason: String(input.reason ?? 'unknown') },
        thought: String(input.reason ?? ''),
      };
    default:
      return { action: { type: 'fail', reason: `unknown tool "${name}"` }, thought: '' };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
