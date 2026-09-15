import { ShopifyError } from './shopify-client.js';

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
    throw new ShopifyError(
      `Token request to ${shop} failed: ${err instanceof Error ? err.message : String(err)}`
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

export async function resolveAccessToken(
  shop: string,
  opts: CredentialOptions
): Promise<string> {
  if (opts.token) return opts.token;
  if (opts.clientId && opts.clientSecret) {
    return mintToken(shop, opts.clientId, opts.clientSecret);
  }
  throw new ShopifyError(
    'Missing credentials.',
    'Provide --client-id + --client-secret (Dev Dashboard flow, recommended) or --token (legacy shpat_ token).'
  );
}
