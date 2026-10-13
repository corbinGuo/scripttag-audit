import type {
  EnrichedTag,
  ScanReport,
  ScanSummary,
  ScriptTag,
  VendorConfidence,
} from './types.js';
import type { ThemeHit } from './shopify-client.js';
import { classifyDisplayScope, buildAdvice } from './analysis/classify.js';
import { extractHost, lookupVendor } from './vendor-map.js';

export function enrich(tag: ScriptTag): EnrichedTag {
  const host = extractHost(tag.src);
  const vendorEntry = lookupVendor(host);
  const status = classifyDisplayScope(tag.displayScope);
  return {
    ...tag,
    host,
    vendor: vendorEntry?.vendor ?? null,
    vendorConfidence: vendorEntry?.confidence ?? null,
    vendorCategory: vendorEntry?.category ?? null,
    status,
    advice: buildAdvice(status, vendorEntry?.category ?? null),
    surface: 'scriptTag',
  };
}

function enrichThemeHit(hit: ThemeHit, scannedAt: string): EnrichedTag {
  // Protocol-relative srcs get https: so host extraction and vendors resolve.
  const src = hit.src.startsWith('//') ? `https:${hit.src}` : hit.src;
  const host = extractHost(src);
  const vendorEntry = lookupVendor(host);
  const status = 'theme' as const;
  return {
    id: hit.id,
    src,
    // No API object exists for theme embeds — creation time is unknowable;
    // the scan timestamp stands in so renderers can slice it safely.
    createdAt: scannedAt,
    updatedAt: scannedAt,
    displayScope: 'THEME',
    host,
    vendor: vendorEntry?.vendor ?? null,
    vendorConfidence: vendorEntry?.confidence ?? null,
    vendorCategory: vendorEntry?.category ?? null,
    status,
    advice: buildAdvice(status, vendorEntry?.category ?? null),
    surface: 'theme',
    sourceFile: hit.sourceFile,
  };
}

export function summarize(tags: EnrichedTag[]): ScanSummary {
  const apiTags = tags.filter((t) => t.status !== 'theme');
  const affected = apiTags.filter((t) => t.status === 'affected-storefront').length;
  const dead = apiTags.filter((t) => t.status === 'dead-order-status').length;
  const unknown = apiTags.filter((t) => t.status === 'unknown').length;
  const theme = tags.length - apiTags.length;

  const vendorCounts = new Map<string, number>();
  for (const t of apiTags) {
    if (t.vendor && t.status === 'affected-storefront') {
      vendorCounts.set(t.vendor, (vendorCounts.get(t.vendor) ?? 0) + 1);
    }
  }
  const topVendors = [...vendorCounts.entries()]
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { total: tags.length, affected, dead, unknown, theme, topVendors };
}

export function buildReport(
  store: string,
  apiVersion: string,
  tags: ScriptTag[],
  themeHits: ThemeHit[] = []
): ScanReport {
  const scannedAt = new Date().toISOString();
  const enriched = [
    ...tags.map(enrich),
    ...themeHits.map((hit) => enrichThemeHit(hit, scannedAt)),
  ];
  return {
    store,
    apiVersion,
    scannedAt,
    tags: enriched,
    summary: summarize(enriched),
  };
}
