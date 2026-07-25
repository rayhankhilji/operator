import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Settings {
  model: string;
  homeUrl: string;
  confirmSideEffects: boolean;
  allowedDomains: string[];
  maxSteps: number;
}

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-opus-5',
  homeUrl: 'https://duckduckgo.com',
  confirmSideEffects: false,
  allowedDomains: [],
  maxSteps: 40,
};

interface Persisted extends Settings {
  /** The API key, encrypted at rest by the OS keychain when available. */
  apiKeyCipher?: string;
  apiKeyPlain?: string;
}

/**
 * Settings on disk.
 *
 * The API key gets `safeStorage`, which on macOS means the system Keychain and
 * on Linux the desktop secret service. When no backend is available Electron
 * cannot encrypt anything, and rather than pretend otherwise this stores the
 * key in plain text under a differently-named field — so it is obvious from
 * the file itself which of the two happened.
 */
export class Store {
  private readonly file: string;
  private data: Persisted;

  constructor() {
    this.file = join(app.getPath('userData'), 'operator.json');
    this.data = this.read();
  }

  private read(): Persisted {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(this.file, 'utf8')) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  getSettings(): Settings {
    const { apiKeyCipher, apiKeyPlain, ...settings } = this.data;
    void apiKeyCipher;
    void apiKeyPlain;
    return settings;
  }

  saveSettings(partial: Partial<Settings>): Settings {
    this.data = { ...this.data, ...partial };
    this.write();
    return this.getSettings();
  }

  hasApiKey(): boolean {
    return Boolean(this.data.apiKeyCipher || this.data.apiKeyPlain || process.env.ANTHROPIC_API_KEY);
  }

  /** True when the stored key is protected by the OS, false when it is not. */
  isKeyEncrypted(): boolean {
    return Boolean(this.data.apiKeyCipher);
  }

  setApiKey(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) {
      delete this.data.apiKeyCipher;
      delete this.data.apiKeyPlain;
      this.write();
      return;
    }
    if (safeStorage.isEncryptionAvailable()) {
      this.data.apiKeyCipher = safeStorage.encryptString(trimmed).toString('base64');
      delete this.data.apiKeyPlain;
    } else {
      this.data.apiKeyPlain = trimmed;
      delete this.data.apiKeyCipher;
    }
    this.write();
  }

  getApiKey(): string | null {
    if (this.data.apiKeyCipher) {
      try {
        return safeStorage.decryptString(Buffer.from(this.data.apiKeyCipher, 'base64'));
      } catch {
        // Keychain entry gone, or the file moved between machines.
        return null;
      }
    }
    if (this.data.apiKeyPlain) return this.data.apiKeyPlain;
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}
