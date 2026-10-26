import type { MigrationAdvice, TagStatus } from '../types.js';

export const DEADLINE_API_BREAK = '2026-10-01';
export const DEADLINE_STOREFRONT = '2027-03-01';

/**
 * Official migration documentation. Anchors within the page may move;
 * TODO-VERIFY the exact anchor after review.
 */
export const MIGRATION_DOC_URL =
  'https://shopify.dev/docs/apps/build/online-store';

export function classifyDisplayScope(displayScope: string): TagStatus {
  switch (displayScope) {
    case 'ONLINE_STORE':
    case 'ALL':
      // Storefront tags: new installs break after 2026-10-01, everything
      // stops running 2027-03-01.
      return 'affected-storefront';
    case 'ORDER_STATUS':
      // Order status page scripts were retired by an earlier deprecation.
      return 'dead-order-status';
    default:
      return 'unknown';
  }
}

const WEB_PIXEL_CATEGORIES = new Set([
  'Analytics',
  'Pixel/Tracking',
  'Session Recording',
  'A/B Testing',
  'Error Monitoring',
]);

/**
 * Heuristic: pure analytics/conversion scripts can become web pixels
 * (no merchant action required). Anything user-visible (chat, popups,
 * reviews, push prompts...) needs an app embed block in a theme app
 * extension, which merchants must manually activate per theme.
 */
function guessReplacement(vendorCategory: string | null): 'web-pixel' | 'app-embed' {
  if (vendorCategory && WEB_PIXEL_CATEGORIES.has(vendorCategory)) {
    return 'web-pixel';
  }
  return 'app-embed';
}

export function buildAdvice(
  status: TagStatus,
  vendorCategory: string | null
): MigrationAdvice {
  if (status === 'appEmbed') {
    return {
      replacement: 'theme-embed',
      summary:
        'Served by a theme app extension (app embed). NOT affected by the ' +
        'deprecation — it keeps running after 2027-03-01. Only check that the ' +
        'app embed is enabled on the published theme.',
      docUrl: 'https://shopify.dev/docs/apps/build/online-store/theme-app-extensions',
    };
  }
  if (status === 'theme') {
    return {
      replacement: 'theme-embed',
      summary:
        'Hard-coded in a theme liquid file. NOT affected by the deprecation — ' +
        'only API-injected script tags stop running — but every update needs a ' +
        'manual theme edit. Ask the vendor for an app embed block so updates ' +
        'become automatic.',
      docUrl: 'https://shopify.dev/docs/apps/build/online-store/theme-app-extensions',
    };
  }
  if (status === 'dead-order-status') {
    return {
      replacement: 'cleanup',
      summary:
        'Already non-functional (order status scripts were retired earlier). ' +
        'Safe to delete via scriptTagDelete to reduce clutter.',
      docUrl: MIGRATION_DOC_URL,
    };
  }
  if (status === 'affected-storefront') {
    const replacement = guessReplacement(vendorCategory);
    const summary =
      replacement === 'web-pixel'
        ? `Analytics-style script. Migrate to a web pixel extension (no merchant ` +
          `action required). New installs break after ${DEADLINE_API_BREAK}; ` +
          `all storefront tags stop running ${DEADLINE_STOREFRONT}.`
        : `Visible-feature script. Migrate to an app embed block inside a theme ` +
          `app extension (merchants must activate it in the theme editor, per ` +
          `theme). New installs break after ${DEADLINE_API_BREAK}; all ` +
          `storefront tags stop running ${DEADLINE_STOREFRONT}.`;
    return { replacement, summary, docUrl: MIGRATION_DOC_URL };
  }
  return {
    replacement: 'ask-vendor',
    summary:
      'Unrecognized display scope. Ask the app vendor whether their storefront ' +
      'code ships as a script tag, an app embed, or a web pixel.',
    docUrl: MIGRATION_DOC_URL,
  };
}
