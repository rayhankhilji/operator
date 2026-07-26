import { app, BrowserWindow, ipcMain, shell, webContents } from 'electron';
import { join } from 'node:path';
import {
  OperatorAgent,
  callExpression,
  captureExpression,
  type AgentEvent,
} from '@operator/core';

import { ElectronDriver } from './driver.js';
import { Store, type Settings } from './store.js';

/**
 * The main process owns two things the renderer must never touch: the API key,
 * and the agent loop that uses it. The renderer gets a stream of events and a
 * handful of commands, and nothing else.
 */

let window: BrowserWindow | null = null;
let agent: OperatorAgent | null = null;
let store: Store;

/** The webContents id of the <webview> the agent drives. */
let viewId: number | null = null;

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    // The chrome is ours, not the OS's — the traffic lights sit inside our UI.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 22 },
    backgroundColor: '#fcfcfb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  window.on('ready-to-show', () => window?.show());

  // Anything the app itself tries to open in a new window goes to the real
  // browser, not to an unsupervised Electron window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function send(channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
}

function driverOrThrow(): ElectronDriver {
  if (viewId === null) throw new Error('no browser view is attached yet');
  const contents = webContents.fromId(viewId);
  if (!contents || contents.isDestroyed()) throw new Error('the browser view is gone');
  return new ElectronDriver(contents);
}

app.whenReady().then(() => {
  store = new Store();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// -- IPC ---------------------------------------------------------------------

ipcMain.handle('view:attach', (_event, id: number) => {
  viewId = id;

  const contents = webContents.fromId(id);
  if (contents) {
    // The page inside the webview may try to open popups; route them into the
    // same view rather than spawning windows the agent cannot see.
    contents.setWindowOpenHandler(({ url }) => {
      void contents.loadURL(url);
      return { action: 'deny' };
    });
  }
  return true;
});

ipcMain.handle('settings:get', () => ({
  settings: store.getSettings(),
  hasApiKey: store.hasApiKey(),
  keyEncrypted: store.isKeyEncrypted(),
}));

ipcMain.handle('settings:save', (_event, partial: Partial<Settings>) => store.saveSettings(partial));

ipcMain.handle('settings:set-api-key', (_event, key: string) => {
  store.setApiKey(key);
  return { hasApiKey: store.hasApiKey(), keyEncrypted: store.isKeyEncrypted() };
});

ipcMain.handle('agent:run', async (_event, payload: { goal: string; startUrl?: string }) => {
  if (agent) return { ok: false, error: 'a run is already in progress' };

  const apiKey = store.getApiKey();
  if (!apiKey) return { ok: false, error: 'no API key is set' };

  let driver: ElectronDriver;
  try {
    driver = driverOrThrow();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const settings = store.getSettings();
  agent = new OperatorAgent({
    driver,
    apiKey,
    model: settings.model,
    autonomy: {
      confirmSideEffects: settings.confirmSideEffects,
      allowedDomains: settings.allowedDomains,
      maxSteps: settings.maxSteps,
    },
    onEvent: (event: AgentEvent) => send('agent:event', event),
  });

  try {
    const result = await agent.run(payload.goal, payload.startUrl);
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send('agent:event', { type: 'run-failed', reason: message } satisfies AgentEvent);
    return { ok: false, error: message };
  } finally {
    agent = null;
  }
});

ipcMain.handle('agent:cancel', () => {
  agent?.cancel();
  return true;
});

ipcMain.handle('agent:confirm', (_event, approved: boolean) => {
  agent?.respondToConfirm(approved);
  return true;
});

ipcMain.handle('agent:resume', () => {
  agent?.resumeFromHandoff();
  return true;
});

/**
 * Show the person where a recorded fact came from: go back to the page it was
 * read on if we have drifted away, then outline the element.
 */
ipcMain.handle('view:reveal', async (_event, payload: { url: string; ref?: string }) => {
  const driver = driverOrThrow();
  if (payload.url && (await driver.url()) !== payload.url) {
    await driver.navigate(payload.url);
  }
  if (!payload.ref) return { ok: true };

  // Refs belong to one observation, so the map has to be rebuilt before the
  // ref means anything on a page we have just navigated back to.
  await driver.evaluate(captureExpression(1200));
  const raw = await driver.evaluate<string>(callExpression('flash', [payload.ref]));
  return JSON.parse(raw) as { ok: boolean; error?: string };
});

/** Plain manual browsing, for when the person is driving. */
ipcMain.handle('view:navigate', async (_event, url: string) => {
  const driver = driverOrThrow();
  await driver.navigate(url);
  return true;
});
