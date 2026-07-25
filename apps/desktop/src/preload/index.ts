import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent } from '@operator/core';

/**
 * The only surface the UI has on the main process.
 *
 * Deliberately narrow: no arbitrary IPC, no `invoke` passthrough, and above all
 * no way to read the API key back out. The renderer can ask for a run and can
 * watch what happens; it cannot see the credential that makes the run possible.
 */
export interface Settings {
  model: string;
  homeUrl: string;
  confirmSideEffects: boolean;
  allowedDomains: string[];
  maxSteps: number;
}

export interface RunResultPayload {
  ok: boolean;
  error?: string;
  result?: { status: string; summary: string; data: Record<string, unknown> };
}

const api = {
  attachView: (webContentsId: number): Promise<boolean> =>
    ipcRenderer.invoke('view:attach', webContentsId),

  navigate: (url: string): Promise<boolean> => ipcRenderer.invoke('view:navigate', url),

  getSettings: (): Promise<{ settings: Settings; hasApiKey: boolean; keyEncrypted: boolean }> =>
    ipcRenderer.invoke('settings:get'),

  saveSettings: (partial: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:save', partial),

  setApiKey: (key: string): Promise<{ hasApiKey: boolean; keyEncrypted: boolean }> =>
    ipcRenderer.invoke('settings:set-api-key', key),

  run: (goal: string, startUrl?: string): Promise<RunResultPayload> =>
    ipcRenderer.invoke('agent:run', { goal, startUrl }),

  cancel: (): Promise<boolean> => ipcRenderer.invoke('agent:cancel'),
  confirm: (approved: boolean): Promise<boolean> => ipcRenderer.invoke('agent:confirm', approved),
  resume: (): Promise<boolean> => ipcRenderer.invoke('agent:resume'),

  /** Subscribe to the agent's event stream. Returns an unsubscribe function. */
  onEvent: (handler: (event: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: AgentEvent): void => handler(payload);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.off('agent:event', listener);
  },
};

export type OperatorApi = typeof api;

contextBridge.exposeInMainWorld('operator', api);
