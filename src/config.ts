import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Local credential profiles, keyed by shop domain. Lives in the user config
 * directory (never in the repo). Scan reads it so a store can be audited
 * without pasting credentials after the first `login`.
 */

export interface StoredProfile {
  shop: string;
  clientId: string;
  clientSecret?: string;
  accessToken?: string;
  tokenScope?: string;
  obtainedAt?: string; // ISO timestamp of when accessToken was issued
}

interface CredentialFile {
  version: 1;
  stores: Record<string, StoredProfile>;
}

export function configDir(): string {
  if (process.env.SCRIPTTAG_AUDIT_CONFIG_DIR) {
    return process.env.SCRIPTTAG_AUDIT_CONFIG_DIR;
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'scripttag-audit');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'scripttag-audit');
}

function credentialPath(): string {
  return join(configDir(), 'credentials.json');
}

function load(): CredentialFile {
  try {
    const raw = readFileSync(credentialPath(), 'utf8');
    const parsed = JSON.parse(raw) as CredentialFile;
    if (parsed.version === 1 && parsed.stores && typeof parsed.stores === 'object') {
      return parsed;
    }
  } catch {
    // missing or unreadable -> treat as empty
  }
  return { version: 1, stores: {} };
}

function save(file: CredentialFile): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const path = credentialPath();
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // chmod is a no-op on Windows; ACLs from the user profile apply.
  }
}

export function saveProfile(profile: StoredProfile): void {
  const file = load();
  file.stores[profile.shop] = profile;
  save(file);
}

export function getProfile(shop: string): StoredProfile | null {
  return load().stores[shop] ?? null;
}

export function deleteProfile(shop: string): boolean {
  const file = load();
  if (!file.stores[shop]) return false;
  delete file.stores[shop];
  save(file);
  return true;
}

/** All shops with a saved profile, sorted for stable listing. */
export function listShops(): string[] {
  return Object.keys(load().stores).sort();
}

/**
 * Location shown to users when explaining where credentials are kept.
 */
export function credentialDisplayPath(): string {
  return credentialPath();
}
