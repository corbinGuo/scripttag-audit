import { Command } from 'commander';
import { ShopifyError } from '../shopify-client.js';
import { deleteProfile, listShops } from '../config.js';
import { normalizeShopDomain } from '../util.js';

export function registerLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Remove saved credentials for a store')
    .option('--store <domain>', 'Shop domain (optional when only one store is saved)')
    .action(async (opts: { store?: string }) => {
      let shop: string | null = null;
      if (opts.store) {
        shop = normalizeShopDomain(opts.store);
      } else {
        const shops = listShops();
        if (shops.length === 1) {
          shop = shops[0];
        } else if (shops.length === 0) {
          console.log('No saved credentials.');
          return;
        } else {
          throw new ShopifyError(
            `Multiple stores are saved: ${shops.join(', ')}.`,
            'Pass --store to choose which one to log out.'
          );
        }
      }

      if (deleteProfile(shop)) {
        console.log(`✔ Removed saved credentials for ${shop}.`);
      } else {
        console.log(`No saved credentials for ${shop}.`);
      }
    });
}
