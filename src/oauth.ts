import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { ShopifyError } from './shopify-client.js';

export const DEFAULT_CALLBACK_PORT = 3739;
export const REQUIRED_SCOPE = 'read_script_tags';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface OAuthResult {
  shop: string;
  accessToken: string;
  scope: string;
}

/**
 * Shopify signs the install callback as HMAC-SHA256 over the query params
 * (excluding hmac and signature), sorted by key, joined as k=v with '&'.
 * Exported for tests.
 */
export function verifyCallbackHmac(
  params: Record<string, string>,
  clientSecret: string
): boolean {
  const given = params.hmac;
  if (!given) return false;
  const message = Object.keys(params)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const expected = createHmac('sha256', clientSecret).update(message).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      // rundll32 takes the URL as a plain argument — no shell, so '&' in the
      // query string survives without escaping.
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Best effort — the URL is always printed too.
  }
}

function parseCallbackQuery(req: IncomingMessage): Record<string, string> {
  const raw = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
  const params: Record<string, string> = {};
  for (const [k, v] of raw.entries()) params[k] = v;
  return params;
}

function respond(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>scripttag-audit</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
${html}
</body>`);
}

export interface OAuthFlowOptions {
  shop: string;
  clientId: string;
  clientSecret: string;
  port: number;
  onAuthorizeUrl?: (url: string) => void;
}

/**
 * Interactive OAuth authorization-code flow against `shop`, with the local
 * HTTP callback on 127.0.0.1:<port>. The redirect URI must be whitelisted in
 * the Dev Dashboard app config as http://127.0.0.1:<port>/callback.
 *
 * The flow yields an offline access token (no grant_options[] param), which
 * is what a CLI wants: it outlives the browser session.
 */
export function runOAuthFlow(opts: OAuthFlowOptions): Promise<OAuthResult> {
  const { shop, clientId, clientSecret, port } = opts;
  const state = randomBytes(16).toString('hex');

  return new Promise<OAuthResult>((resolve, reject) => {
    let server: Server | null = null;
    const fail = (err: ShopifyError) => {
      server?.close();
      reject(err);
    };

    const timeout = setTimeout(() => {
      fail(
        new ShopifyError(
          'Timed out waiting for the OAuth callback (5 minutes).',
          'Re-run `scripttag-audit login` and complete the browser authorization.'
        )
      );
    }, AUTH_TIMEOUT_MS);

    server = createServer((req, res) => {
      void (async () => {
        const url = req.url ?? '/';
        if (!url.startsWith('/callback')) {
          respond(
            res,
            404,
            '<p>Waiting for the Shopify OAuth callback at <code>/callback</code>…</p>'
          );
          return;
        }

        const params = parseCallbackQuery(req);
        clearTimeout(timeout);

        if (params.error) {
          respond(res, 400, '<h2>❌ Authorization denied</h2><p>You can close this tab.</p>');
          fail(new ShopifyError(`Authorization was denied: ${params.error}`));
          return;
        }
        if (params.state !== state) {
          respond(res, 400, '<h2>❌ Invalid state</h2><p>You can close this tab.</p>');
          fail(new ShopifyError('OAuth state mismatch (possible CSRF) — aborting.'));
          return;
        }
        if (params.shop && params.shop.toLowerCase() !== shop) {
          respond(res, 400, '<h2>❌ Wrong shop</h2><p>You can close this tab.</p>');
          fail(
            new ShopifyError(
              `Callback came from ${params.shop} but login was started for ${shop}.`
            )
          );
          return;
        }
        if (!params.code) {
          fail(new ShopifyError('OAuth callback did not include an authorization code.'));
          return;
        }
        if (!verifyCallbackHmac(params, clientSecret)) {
          respond(res, 400, '<h2>❌ Invalid signature</h2><p>You can close this tab.</p>');
          fail(
            new ShopifyError(
              'OAuth callback HMAC verification failed.',
              'Check that the client secret matches the Dev Dashboard app.'
            )
          );
          return;
        }

        // Exchange the code for an offline access token.
        let tokenRes: Response;
        try {
          tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              code: params.code,
            }),
          });
        } catch (err) {
          fail(
            new ShopifyError(
              `Token exchange to ${shop} failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            )
          );
          return;
        }
        if (!tokenRes.ok) {
          respond(res, 502, '<h2>❌ Token exchange failed</h2><p>You can close this tab.</p>');
          fail(
            new ShopifyError(
              `Token exchange failed (HTTP ${tokenRes.status}).`,
              'Verify client_id / client_secret and that this redirect URI is whitelisted in the app config.'
            )
          );
          return;
        }
        const body = (await tokenRes.json()) as { access_token?: string; scope?: string };
        if (!body.access_token) {
          fail(new ShopifyError('Token exchange response did not contain an access_token.'));
          return;
        }

        respond(
          res,
          200,
          `<h2>✅ Login complete</h2><p><code>scripttag-audit</code> is authorized for <b>${shop}</b>. You can close this tab.</p>`
        );
        server?.close();
        clearTimeout(timeout);
        resolve({ shop, accessToken: body.access_token, scope: body.scope ?? '' });
      })();
    });

    server.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        fail(
          new ShopifyError(
            `Port ${port} is already in use — the OAuth callback server cannot start.`,
            `Close whatever is using it, or retry with a different --port. Remember to whitelist http://127.0.0.1:<port>/callback in the app config.`
          )
        );
      } else {
        fail(new ShopifyError(`Local callback server failed: ${err.message}`));
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const authorizeUrl =
        `https://${shop}/admin/oauth/authorize` +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&scope=${REQUIRED_SCOPE}` +
        `&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}/callback`)}` +
        `&state=${state}`;
      opts.onAuthorizeUrl?.(authorizeUrl);
      openBrowser(authorizeUrl);
    });
  });
}
