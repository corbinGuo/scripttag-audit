import { Command } from 'commander';
import { fetchAllScriptTags, ShopifyError } from '../shopify-client.js';
import { resolveAccessToken } from '../auth.js';
import { buildReport } from '../report-builder.js';
import { renderTable, renderJson, renderCsv } from '../report.js';

function normalizeShopDomain(raw: string): string {
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

const TOKEN_HELP = `
How to get credentials (2026 Dev Dashboard flow):
  1. dev.shopify.com -> Apps -> Create app
  2. Create a version with Admin API scope: read_script_tags
  3. Release the version, then Install -> your store
  4. Settings -> copy Client ID and Client secret
  5. Run with --client-id + --client-secret (a fresh ~24h token is minted per run)
  Legacy --token (shpat_...) from pre-2026 custom apps still works.
`.trim();

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Audit a Shopify store for script tags affected by the 2027 deprecation')
    .requiredOption('--store <domain>', 'Shop domain, e.g. my-store.myshopify.com')
    .option('--token <token>', 'Legacy static Admin API token (shpat_..., pre-2026 custom apps)')
    .option('--client-id <id>', 'Dev Dashboard app Client ID (recommended)')
    .option('--client-secret <secret>', 'Dev Dashboard app Client secret (recommended)')
    .option('--format <format>', 'Output format: table | json | csv', 'table')
    .option('--api-version <version>', 'Admin API version to use', '2026-07')
    .addHelpText('after', `\n${TOKEN_HELP}`)
    .action(
      async (opts: {
        store: string;
        token?: string;
        clientId?: string;
        clientSecret?: string;
        format: string;
        apiVersion: string;
      }) => {
        if (!['table', 'json', 'csv'].includes(opts.format)) {
          throw new ShopifyError(`Unknown format "${opts.format}". Use table | json | csv.`);
        }

        const store = normalizeShopDomain(opts.store);
        if (!store.endsWith('.myshopify.com')) {
          console.error(
            `note: "${store}" is not a .myshopify.com domain — continuing (custom domains are allowed).`
          );
        }

        const token = await resolveAccessToken(store, opts);
        const tags = await fetchAllScriptTags(store, token, opts.apiVersion);
      const report = buildReport(store, opts.apiVersion, tags);

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
