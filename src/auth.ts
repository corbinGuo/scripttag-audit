import { ShopifyError } from './shopify-client.js';
import { getProfile, saveProfile } from './config.js';

/**
 * Dev Dashboard apps (the only kind creatable since 2026-01-01) no longer
 * expose static shpat_ tokens. Authentication is the client-credentials
 * grant, which yields a short-lived (~24h) access token. Minting a fresh
 * token per CLI run sidesteps expiry entirely.
 */
export async function mintToken(
  shop: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (err) {
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? ` (${err.cause.message})`
        : '';
    throw new ShopifyError(
      `Token request to ${shop} failed: ${
        err instanceof Error ? err.message : String(err)
      }${cause}`,
      'If the cause looks like DNS/timeout/connection reset, it is usually a transient network problem — retry once before debugging credentials.'
    );
  }
  if (!res.ok) {
    throw new ShopifyError(
      `Token request failed (HTTP ${res.status}).`,
      'Check client_id / client_secret (Dev Dashboard → your app → Settings) and that the app is installed on this store with the read_script_tags scope.'
    );
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new ShopifyError('Token response did not contain an access_token.');
  }
  return body.access_token;
}

export interface CredentialOptions {
  token?: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Credential resolution order:
 *   1. explicit flags (--token / --client-id + --client-secret)
 *   2. environment (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET)
 *   3. saved profile from `login` — mint a fresh token when the secret is
 *      stored (preferred), else fall back to the cached access token
 */
export async function resolveAccessToken(
  shop: string,
  opts: CredentialOptions
): Promise<string> {
  const clientId = opts.clientId ?? process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = opts.clientSecret ?? process.env.SHOPIFY_CLIENT_SECRET;

  if (opts.token) return opts.token;
  if (clientId && clientSecret) {
    return mintToken(shop, clientId, clientSecret);
  }

  const profile = getProfile(shop);
  if (profile?.clientId && profile?.clientSecret) {
    const token = await mintToken(shop, profile.clientId, profile.clientSecret);
    // Keep the cache warm for tools reading the file, and so a future
    // fallback path has something fresh to use.
    saveProfile({ ...profile, accessToken: token, obtainedAt: new Date().toISOString() });
    return token;
  }
  if (profile?.accessToken) {
    console.error(
      `note: using the cached access token for ${shop} (no client secret stored). ` +
        'If it has expired, run `scripttag-audit login` again.'
    );
    return profile.accessToken;
  }

  throw new ShopifyError(
    'Missing credentials.',
    'Run `scripttag-audit login` once, or provide --client-id + --client-secret ' +
      '(Dev Dashboard flow), or --token (legacy shpat_ token).'
  );
}
