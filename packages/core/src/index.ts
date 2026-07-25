/**
 * @operator/core — the reasoning engine behind Operator.
 *
 * Nothing in here knows about Electron, or about any particular browser. The
 * engine talks to a `BrowserDriver`, and anything that can evaluate JavaScript
 * in a page and dispatch trusted input events can be one.
 */

export * from './types.js';

export { OperatorAgent, DEFAULT_AUTONOMY } from './agent/loop.js';
export type { AgentOptions, RunResult } from './agent/loop.js';
export { Executor, delay } from './agent/executor.js';
export { TOOLS, parseToolCall } from './agent/tools.js';
export { systemPrompt, goalMessage, observationMessage } from './agent/prompt.js';

export { observe } from './perception/observer.js';
export type { ObserveOptions } from './perception/observer.js';
export { serializePageMap, describeNode, findNode } from './perception/serialize.js';
export type { SerializeOptions } from './perception/serialize.js';
export { PERCEPTION_SCRIPT, captureExpression, callExpression } from './perception/injected.js';

export { evaluate as evaluateAction } from './safety/policy.js';
export { classifyControl, checkUrl, isPrivateHost, ALWAYS_CONFIRM, ALWAYS_HANDOFF } from './safety/detectors.js';
export type { ControlIntent } from './safety/detectors.js';
