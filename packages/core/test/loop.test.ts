import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';

import { OperatorAgent } from '../src/agent/loop.js';
import type { AgentEvent, PageMap } from '../src/types.js';
import { FakeDriver, makeMap } from './helpers.js';

/** A scripted stand-in for the model: replays a fixed list of tool calls. */
function scriptedClient(turns: Array<{ name: string; input: Record<string, unknown>; text?: string }>) {
  let index = 0;
  return {
    messages: {
      stream(_params: unknown) {
        const turn = turns[index++] ?? { name: 'fail', input: { reason: 'script exhausted' } };
        const content: Anthropic.ContentBlock[] = [];
        if (turn.text) content.push({ type: 'text', text: turn.text, citations: null } as Anthropic.TextBlock);
        content.push({
          type: 'tool_use',
          id: `tu_${index}`,
          name: turn.name,
          input: turn.input,
        } as Anthropic.ToolUseBlock);

        return {
          on(_event: string, _cb: unknown) { return this; },
          async finalMessage(): Promise<Anthropic.Message> {
            return { content } as Anthropic.Message;
          },
        };
      },
    },
  } as unknown as Anthropic;
}

function driverShowing(map: PageMap): FakeDriver {
  const driver = new FakeDriver();
  driver.responses.capture = map;
  driver.responses.locate = { ok: true, x: 50, y: 50 };
  driver.responses.prepareInput = { ok: true };
  return driver;
}

describe('OperatorAgent', () => {
  test('runs a simple goal to completion and records findings', async () => {
    const map = makeMap([
      { ref: 'e0', role: 'textbox', name: 'Search' },
      { ref: 'e1', role: 'button', name: 'Search flights' },
    ]);
    const driver = driverShowing(map);
    const events: AgentEvent[] = [];

    const agent = new OperatorAgent({
      driver,
      apiKey: 'test',
      onEvent: (e) => events.push(e),
      client: scriptedClient([
        { name: 'type', input: { ref: 'e0', text: 'Lisbon', why: 'entering the destination' } },
        { name: 'click', input: { ref: 'e1', why: 'running the search' } },
        { name: 'extract', input: { query: 'cheapest fare', value: 142 } },
        { name: 'done', input: { summary: 'Found a fare at £142.' } },
      ]),
    });

    const result = await agent.run('find a cheap flight to Lisbon');

    assert.equal(result.status, 'done');
    assert.equal(result.summary, 'Found a fare at £142.');
    assert.equal(result.data['cheapest fare'], 142);
    assert.ok(driver.calls.includes('type:Lisbon'));
    assert.ok(events.some((e) => e.type === 'run-finished'));
  });

  test('pauses for approval before spending money, and honours a decline', async () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Place order' }]);
    const driver = driverShowing(map);
    const events: AgentEvent[] = [];

    const agent = new OperatorAgent({
      driver,
      apiKey: 'test',
      onEvent: (e) => {
        events.push(e);
        // Decline the moment the loop asks.
        if (e.type === 'confirm-required') queueMicrotask(() => agent.respondToConfirm(false));
      },
      client: scriptedClient([
        { name: 'click', input: { ref: 'e1', why: 'placing the order' } },
        { name: 'fail', input: { reason: 'the person declined the purchase' } },
      ]),
    });

    const result = await agent.run('buy the thing');

    const confirm = events.find((e) => e.type === 'confirm-required');
    assert.ok(confirm, 'should have asked before ordering');
    assert.equal(result.status, 'failed');
    assert.equal(
      driver.calls.some((c) => c.startsWith('click:')),
      false,
      'a declined action must never reach the page',
    );
  });

  test('proceeds once the person approves', async () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Place order' }]);
    const driver = driverShowing(map);

    const agent = new OperatorAgent({
      driver,
      apiKey: 'test',
      onEvent: (e) => {
        if (e.type === 'confirm-required') queueMicrotask(() => agent.respondToConfirm(true));
      },
      client: scriptedClient([
        { name: 'click', input: { ref: 'e1', why: 'placing the order' } },
        { name: 'done', input: { summary: 'Ordered.' } },
      ]),
    });

    const result = await agent.run('buy the thing');
    assert.equal(result.status, 'done');
    assert.ok(driver.calls.some((c) => c.startsWith('click:')));
  });

  test('hands the page over at a password field and resumes afterwards', async () => {
    const map = makeMap([
      { ref: 'e1', role: 'textbox', name: 'Password', sensitive: 'password' },
    ]);
    const driver = driverShowing(map);
    const events: AgentEvent[] = [];

    const agent = new OperatorAgent({
      driver,
      apiKey: 'test',
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'handoff-required') queueMicrotask(() => agent.resumeFromHandoff());
      },
      client: scriptedClient([
        { name: 'type', input: { ref: 'e1', text: 'hunter2', why: 'signing in' } },
        { name: 'done', input: { summary: 'Signed in by the person.' } },
      ]),
    });

    const result = await agent.run('log into my account');

    const handoff = events.find((e) => e.type === 'handoff-required');
    assert.ok(handoff, 'a password field must trigger a handoff');
    assert.equal(
      driver.calls.some((c) => c.startsWith('type:')),
      false,
      'the secret must never be typed',
    );
    assert.ok(events.some((e) => e.type === 'human-resumed'));
    assert.equal(result.status, 'done');
  });

  test('a stale ref is fed back as a correction rather than ending the run', async () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Next' }]);
    const driver = driverShowing(map);
    const events: AgentEvent[] = [];

    const agent = new OperatorAgent({
      driver,
      apiKey: 'test',
      onEvent: (e) => events.push(e),
      client: scriptedClient([
        { name: 'click', input: { ref: 'e99', why: 'clicking something that is gone' } },
        { name: 'click', input: { ref: 'e1', why: 'clicking the real button' } },
        { name: 'done', input: { summary: 'Recovered.' } },
      ]),
    });

    const result = await agent.run('click next');
    assert.equal(result.status, 'done');
    const blocked = events.filter((e) => e.type === 'step-finished' && e.step.verdict.decision === 'reject');
    assert.equal(blocked.length, 1);
  });

  test('stops when cancelled', async () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Next' }]);
    const driver = driverShowing(map);

    const agent = new OperatorAgent({
      driver,
      apiKey: 'test',
      client: scriptedClient(
        Array.from({ length: 20 }, () => ({ name: 'click', input: { ref: 'e1', why: 'looping' } })),
      ),
      onEvent: (e) => {
        if (e.type === 'step-finished' && e.step.index === 1) agent.cancel();
      },
    });

    const result = await agent.run('go forever');
    assert.equal(result.status, 'cancelled');
    assert.ok(result.steps.length < 5);
  });

  test('respects the step ceiling', async () => {
    const map = makeMap([{ ref: 'e1', role: 'button', name: 'Next' }]);
    const driver = driverShowing(map);

    const agent = new OperatorAgent({
      driver,
      apiKey: 'test',
      autonomy: { maxSteps: 3 },
      client: scriptedClient(
        Array.from({ length: 20 }, () => ({ name: 'click', input: { ref: 'e1', why: 'looping' } })),
      ),
    });

    const result = await agent.run('go forever');
    assert.equal(result.status, 'failed');
    assert.match(result.summary, /Ran out of steps/);
  });
});
