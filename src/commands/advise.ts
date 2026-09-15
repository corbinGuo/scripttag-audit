import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { ShopifyError } from '../shopify-client.js';
import type { ScanReport } from '../types.js';
import {
  buildAdviceDoc,
  renderAdviceText,
  renderAdviceMarkdown,
  renderVendorEmails,
} from '../advise-core.js';

function loadReport(path: string): ScanReport {
  let raw: string;
  if (path === '-') {
    raw = readFileSync(0, 'utf8');
  } else {
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new ShopifyError(
        `Cannot read report file "${path}".`,
        'Generate one first: scripttag-audit scan --store ... --format json > report.json'
      );
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ShopifyError(`"${path}" is not valid JSON.`);
  }
  const report = parsed as ScanReport;
  if (!report || !Array.isArray(report.tags) || typeof report.store !== 'string') {
    throw new ShopifyError(
      `"${path}" does not look like a scan report.`,
      'Expected the output of `scan --format json` (needs .store and .tags).'
    );
  }
  return report;
}

const ADVISE_HELP = `
Examples:
  scripttag-audit scan --store my-store --format json > report.json
  scripttag-audit advise --report report.json                 # human-readable plan
  scripttag-audit advise --report report.json --format md     # paste into an issue
  scripttag-audit advise --report report.json --email         # vendor inquiry emails

  scan --format json | scripttag-audit advise --report -      # stdin works too

advise is offline: it reads the report, not the store. It always exits 0 on a
valid report (use \`scan\` for the CI gate — it exits 1 while tags remain).
`.trim();

export function registerAdviseCommand(program: Command): void {
  program
    .command('advise')
    .description('Turn a JSON scan report into a per-tag migration plan')
    .requiredOption('--report <path>', 'Path to a `scan --format json` report ("-" for stdin)')
    .option('--format <format>', 'Output format: text | md | json', 'text')
    .option('--email', 'Print ready-to-send vendor inquiry emails instead of the plan')
    .addHelpText('after', `\n${ADVISE_HELP}`)
    .action(async (opts: { report: string; format: string; email?: boolean }) => {
      if (!['text', 'md', 'json'].includes(opts.format)) {
        throw new ShopifyError(`Unknown format "${opts.format}". Use text | md | json.`);
      }
      const report = loadReport(opts.report);
      const doc = buildAdviceDoc(report);

      if (opts.email) {
        process.stdout.write(renderVendorEmails(doc, report));
      } else if (opts.format === 'json') {
        console.log(JSON.stringify(doc, null, 2));
      } else if (opts.format === 'md') {
        process.stdout.write(renderAdviceMarkdown(doc));
      } else {
        console.log(renderAdviceText(doc));
      }
    });
}
