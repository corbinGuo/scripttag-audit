import { Command } from 'commander';
import { ShopifyError } from '../shopify-client.js';
import { DEFAULT_CALLBACK_PORT, REQUIRED_SCOPE, runOAuthFlow } from '../oauth.js';
import { credentialDisplayPath, saveProfile, getProfile } from '../config.js';
import { normalizeShopDomain, prompt } from '../util.js';

const LOGIN_HELP = `
Prerequisites (Dev Dashboard app):
  1. dev.shopify.com -> Apps -> your app
  2. Configuration -> Allowed redirection URL:
       http://127.0.0.1:${DEFAULT_CALLBACK_PORT}/callback
     (use --port if you change the port, then whitelist that port instead)
  3. Keep the app version released with Admin API scope: ${REQUIRED_SCOPE}

What gets stored (in ${credentialDisplayPath()} — never in the repo):
  client id + secret, and the access token. Subsequent scans for this shop
  need no credentials: the CLI mints a fresh token automatically when the
  cached one expires.
`.trim();

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Authorize a store via OAuth (localhost callback) and save the credentials')
    .option('--store <domain>', 'Shop domain, e.g. my-store.myshopify.com')
    .option('--client-id <id>', 'Dev Dashboard app Client ID')
    .option('--client-secret <secret>', 'Dev Dashboard app Client secret')
    .option('--port <number>', 'Local OAuth callback port', String(DEFAULT_CALLBACK_PORT))
    .addHelpText('after', `\n${LOGIN_HELP}`)
    .action(
      async (opts: {
        store?: string;
        clientId?: string;
        clientSecret?: string;
        port: string;
      }) => {
        const port = Number(opts.port);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          throw new ShopifyError(`--port must be an integer in 1024-65535 (got "${opts.port}").`);
        }

        const storeInput = opts.store ?? (await prompt('Store domain', 'my-store.myshopify.com'));
        const store = normalizeShopDomain(storeInput);

        // An existing profile means the secret is already on disk; only the
        // browser consent is needed again.
        const saved = getProfile(store);
        const clientId = opts.clientId ?? (await prompt('Client ID', saved?.clientId));
        if (!clientId) {
          throw new ShopifyError(
            'Client ID is required.',
            'Pass --client-id or set SHOPIFY_CLIENT_ID. Copy it from Dev Dashboard -> your app -> Settings.'
          );
        }
        const clientSecret = opts.clientSecret ?? (await prompt('Client secret', saved?.clientSecret));
        if (!clientSecret) {
          throw new ShopifyError(
            'Client secret is required.',
            'Pass --client-secret or set SHOPIFY_CLIENT_SECRET. Input is echoed — run this in a private window if that matters.'
          );
        }

        console.error(`\nOpening the browser to authorize ${store}...`);
        console.error('(If nothing opens, paste the URL below into a browser.)\n');

        const result = await runOAuthFlow({
          shop: store,
          clientId,
          clientSecret,
          port,
          onAuthorizeUrl: (url) => console.error(url),
        });

        saveProfile({
          shop: result.shop,
          clientId,
          clientSecret,
          accessToken: result.accessToken,
          tokenScope: result.scope,
          obtainedAt: new Date().toISOString(),
        });

        console.log(`\n✔ Saved credentials for ${result.shop}.`);
        console.log(`  Config file: ${credentialDisplayPath()}`);
        console.log(`  Granted scope: ${result.scope || '(unreported by Shopify)'}`);
        console.log(`\nNext: npx scripttag-audit scan --store ${result.shop}`);
        console.log('(no credential flags needed anymore — the CLI re-mints tokens itself)');
      }
    );
}
