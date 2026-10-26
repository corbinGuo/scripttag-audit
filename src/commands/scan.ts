import { Command } from 'commander';
import {
  fetchAllScriptTags,
  fetchAppEmbeds,
  fetchThemeScripts,
  ShopifyError,
} from '../shopify-client.js';
import { resolveAccessToken } from '../auth.js';
import { buildReport } from '../report-builder.js';
import { renderTable, renderJson, renderCsv } from '../report.js';
import { listShops } from '../config.js';
import { normalizeShopDomain } from '../util.js';
import { fetchStorefrontScan, normalizeSrc, type StorefrontHit } from '../storefront.js';

const TOKEN_HELP = `
Storefront-only scan (no credentials, works on any public Shopify store):
  scripttag-audit scan --store my-store.com --storefront-only

Note: client-credentials tokens on some stores cannot read themes. If the
theme scan reports an access-denied note, use \`scripttag-audit login\` (OAuth)
or re-authorize the store with the read_themes scope.

How to get credentials (2026 Dev Dashboard flow):
  Recommended: run \`scripttag-audit login\` once (OAuth, no flag copying).
  Manual alternative:
  1. dev.shopify.com -> Apps -> Create app
  2. Create a version with Admin API scopes: read_script_tags + read_themes
     (read_themes powers the theme-file scan; profiles created before
     v0.3.0 must re-run \`scripttag-audit login\` to request it)
  3. Release the version, then Install -> your store
  4. Settings -> copy Client ID and Client secret
  5. Run with --client-id + --client-secret (a fresh ~24h token is minted per run)
  Legacy --token (shpat_...) from pre-2026 custom apps still works if it has both scopes.
  SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET env vars are also honored.
`.trim();

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description(
      'Audit a Shopify store for script tags ahead of the 2027 deprecation. The storefront HTML scan works without credentials; login adds theme + ScriptTag API surfaces.'
    )
    .option('--store <domain>', 'Shop domain, e.g. my-store.myshopify.com (optional after `login` when exactly one store is saved)')
    .option('--token <token>', 'Legacy static Admin API token (shpat_..., pre-2026 custom apps)')
    .option('--client-id <id>', 'Dev Dashboard app Client ID (recommended)')
    .option('--client-secret <secret>', 'Dev Dashboard app Client secret (recommended)')
    .option('--storefront-only', 'Only scan the public storefront HTML (no Shopify credentials needed)')
    .option('--format <format>', 'Output format: table | json | csv', 'table')
    .option('--api-version <version>', 'Admin API version to use', '2026-07')
    .addHelpText('after', `\n${TOKEN_HELP}`)
    .action(
      async (opts: {
        store?: string;
        token?: string;
        clientId?: string;
        clientSecret?: string;
        storefrontOnly?: boolean;
        format: string;
        apiVersion: string;
      }) => {
        if (!['table', 'json', 'csv'].includes(opts.format)) {
          throw new ShopifyError(`Unknown format "${opts.format}". Use table | json | csv.`);
        }

        if (!opts.store) {
          const shops = listShops();
          if (shops.length === 1) {
            console.error(`note: --store omitted, using the saved store ${shops[0]}.`);
            opts.store = shops[0];
          } else if (shops.length === 0) {
            throw new ShopifyError(
              'Missing --store.',
              'Pass --store <domain>, or run `scripttag-audit login` once and scans for that store need no flags.'
            );
          } else {
            throw new ShopifyError(
              `Multiple saved stores: ${shops.join(', ')}.`,
              'Pass --store to choose one.'
            );
          }
        }

        const store = normalizeShopDomain(opts.store);
        if (!store.endsWith('.myshopify.com')) {
          console.error(
            `note: "${store}" is not a .myshopify.com domain — continuing (custom domains are allowed).`
          );
        }

        const notes: string[] = [];
        let token: string | null = null;
        if (!opts.storefrontOnly) {
          try {
            token = await resolveAccessToken(store, opts);
          } catch (error) {
            const missing =
              error instanceof ShopifyError && error.message === 'Missing credentials.';
            if (!missing) throw error;
            notes.push(
              'No saved Shopify credentials — running a storefront-only scan. ' +
                'Run `scripttag-audit login` to add the theme, ScriptTag API, and app embed checks.'
            );
            console.error('note: no credentials found — running a storefront-only scan.');
          }
        } else {
          notes.push(
            'Storefront-only mode: theme, ScriptTag API, and app embed checks skipped.'
          );
        }

        let apiTags: Awaited<ReturnType<typeof fetchAllScriptTags>> = [];
        let themeHits: Awaited<ReturnType<typeof fetchThemeScripts>> = [];
        let appEmbeds: Awaited<ReturnType<typeof fetchAppEmbeds>> = [];
        if (token) {
          // Each authenticated surface is best-effort: a token missing
          // read_themes must not block the storefront scan.
          try {
            apiTags = await fetchAllScriptTags(store, token, opts.apiVersion);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notes.push(`ScriptTag API scan unavailable (${message}).`);
          }
          try {
            themeHits = await fetchThemeScripts(store, token, opts.apiVersion);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notes.push(`Theme scan unavailable (${message}).`);
          }
          try {
            appEmbeds = await fetchAppEmbeds(store, token, opts.apiVersion);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notes.push(`App embed check unavailable (${message}).`);
          }
        }

        let storefrontHits: StorefrontHit[] = [];
        try {
          const storefront = await fetchStorefrontScan(store);
          notes.push(...storefront.notes);
          const existing = new Set([
            ...themeHits.map((h) => normalizeSrc(h.src)),
            ...apiTags.map((t) => normalizeSrc(t.src)),
          ]);
          storefrontHits = storefront.hits.filter(
            (h) => !existing.has(normalizeSrc(h.src))
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Without credentials there is no other surface — fail loudly.
          if (!token) throw error;
          notes.push(
            `Storefront scan unavailable (${message}). App-injected tags may be missing from this report.`
          );
        }

        const report = buildReport(
          store,
          opts.apiVersion,
          apiTags,
          themeHits,
          storefrontHits,
          notes,
          appEmbeds
        );

      if (opts.format === 'json') {
        console.log(renderJson(report));
      } else if (opts.format === 'csv') {
        process.stdout.write(renderCsv(report));
      } else {
        console.log(renderTable(report));
      }

      // CI gate: fail when affected storefront tags remain.
      if (report.summary.affected > 0) {
        process.exitCode = 1;
      }
    });

  // Keep the deadlines visible in --help.
  program.addHelpText(
    'before',
    `\nShopify deprecation: script tags stop running 2027-03-01 (new installs break 2026-10-01).\n`
  );
}
