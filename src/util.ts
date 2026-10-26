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

/** Read a secret from a pipe/file (e.g. `--client-secret-stdin < secret.txt`). */
export async function readStdinSecret(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

/**
 * Hidden prompt for secrets. Echoes `*` instead of the value on a TTY; when
 * stdin is piped, reads the value without any prompt decoration.
 */
export async function promptSecret(label: string, fallback?: string): Promise<string> {
  const hasFallback = Boolean(fallback);
  if (!input.isTTY) {
    const value = await readStdinSecret();
    return value || fallback || '';
  }

  output.write(`${label}${hasFallback ? ' (saved value)' : ''}: `);
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
    };
    const onData = (chunk: Buffer) => {
      // Strip ANSI sequences (arrow keys, bracketed-paste markers) but keep
      // the pasted text itself.
      const text = chunk.toString('utf8').replace(/\x1b\[[0-9;]*[A-Za-z~]/g, '');
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          output.write('\n');
          resolve(value || fallback || '');
          return;
        }
        if (ch === '') {
          cleanup();
          output.write('\n');
          reject(new ShopifyError('Cancelled.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        if (ch >= ' ') {
          value += ch;
          output.write('*');
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

/**
 * Simple interactive prompt for non-secret values. Input is echoed; use
 * promptSecret for credentials.
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
