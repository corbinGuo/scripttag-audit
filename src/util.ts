import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ShopifyError } from './shopify-client.js';

export function normalizeShopDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!d.includes('.')) {
    d = `${d}.myshopify.com`;
  }
  if (!/^[a-z0-9][a-z0-9-]*\.[a-z0-9.-]+$/.test(d)) {
    throw new ShopifyError(`"${raw}" does not look like a shop domain.`);
  }
  return d;
}

/**
 * Simple interactive prompt. Input is echoed (no hidden mode without
 * dependencies); the help text recommends flags or env vars when the screen
 * is shared.
 */
export async function prompt(label: string, fallback?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const suffix = fallback ? ` (${fallback})` : '';
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    return answer || fallback || '';
  } finally {
    rl.close();
  }
}

export function promptRequired(label: string, hint?: string): () => Promise<string> {
  return async () => {
    for (;;) {
      const v = await prompt(label);
      if (v) return v;
      if (hint) console.error(hint);
    }
  };
}
