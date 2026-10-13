import { Command } from 'commander';
import { fetchAllScanRows, ShopifyError } from '../shopify-client.js';
import { resolveAccessToken } from '../auth.js';
import { buildReport } from '../report-builder.js';
import { renderTable, renderJson, renderCsv } from '../report.js';
import { listShops } from '../config.js';
import { normalizeShopDomain } from '../util.js';

const TOKEN_HELP = `
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
      'Audit a Shopify store for script tags and theme-embedded scripts ahead of the 2027 deprecation'
    )
    .option('--store <domain>', 'Shop domain, e.g. my-store.myshopify.com (optional after `login` when exactly one store is saved)')
    .option('--token <token>', 'Legacy static Admin API token (shpat_..., pre-2026 custom apps)')
    .option('--client-id <id>', 'Dev Dashboard app Client ID (recommended)')
    .option('--client-secret <secret>', 'Dev Dashboard app Client secret (recommended)')
    .option('--format <format>', 'Output format: table | json | csv', 'table')
    .option('--api-version <version>', 'Admin API version to use', '2026-07')
    .addHelpText('after', `\n${TOKEN_HELP}`)
    .action(
      async (opts: {
        store?: string;
        token?: string;
        clientId?: string;
        clientSecret?: string;
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

        const token = await resolveAccessToken(store, opts);
        const { apiTags, themeHits } = await fetchAllScanRows(store, token, opts.apiVersion);
        const report = buildReport(store, opts.apiVersion, apiTags, themeHits);

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
