import type {
  EnrichedTag,
  ScanReport,
  ScanSummary,
  ScriptTag,
  VendorConfidence,
} from './types.js';
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
  };
}

export function summarize(tags: EnrichedTag[]): ScanSummary {
  const affected = tags.filter((t) => t.status === 'affected-storefront').length;
  const dead = tags.filter((t) => t.status === 'dead-order-status').length;
  const unknown = tags.filter((t) => t.status === 'unknown').length;

  const vendorCounts = new Map<string, number>();
  for (const t of tags) {
    if (t.vendor && t.status === 'affected-storefront') {
      vendorCounts.set(t.vendor, (vendorCounts.get(t.vendor) ?? 0) + 1);
    }
  }
  const topVendors = [...vendorCounts.entries()]
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { total: tags.length, affected, dead, unknown, topVendors };
}

export function buildReport(
  store: string,
  apiVersion: string,
  tags: ScriptTag[]
): ScanReport {
  const enriched = tags.map(enrich);
  return {
    store,
    apiVersion,
    scannedAt: new Date().toISOString(),
    tags: enriched,
    summary: summarize(enriched),
  };
}
