#!/usr/bin/env node
import { Command } from 'commander';
import { registerScanCommand } from './commands/scan.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerAdviseCommand } from './commands/advise.js';

const program = new Command();

program
  .name('scripttag-audit')
  .description(
    'Audit Shopify stores for script tags before the March 1, 2027 deprecation.\n' +
      'Source: https://shopify.dev/changelog/online-store-script-tags-deprecation'
  )
  .version('0.2.0');

registerScanCommand(program);
registerLoginCommand(program);
registerLogoutCommand(program);
registerAdviseCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof Error) {
    console.error(err.message);
    const hint = (err as { hint?: string }).hint;
    if (hint) console.error(`\n${hint}`);
  } else {
    console.error(String(err));
  }
  process.exitCode = 1;
});
