import { readFileSync } from 'node:fs';
import type { VendorConfidence } from './types.js';

export interface VendorEntry {
  vendor: string;
  category: string;
  confidence: VendorConfidence;
}

let cache: Map<string, VendorEntry> | null = null;

function loadMap(): Map<string, VendorEntry> {
  if (cache) return cache;
  const map = new Map<string, VendorEntry>();
  try {
    // Resolved relative to the compiled file (dist/vendor-map.js -> ../assets)
    const csvUrl = new URL('../assets/vendor-mapping.csv', import.meta.url);
    const text = readFileSync(csvUrl, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const [host, vendor, category, confidence] = line.split(',');
      if (!host || !vendor) continue;
      map.set(host.trim().toLowerCase(), {
        vendor: vendor.trim(),
        category: (category ?? '').trim(),
        confidence: normalizeConfidence(confidence),
      });
    }
  } catch {
    // Mapping file missing -> lookups just return null. Never crash a scan.
  }
  cache = map;
  return map;
}

function normalizeConfidence(raw: string | undefined): VendorConfidence {
  const v = (raw ?? 'low').trim();
  return v === 'high' || v === 'medium' ? v : 'low';
}

export function extractHost(src: string): string | null {
  try {
    const normalized = src.startsWith('//') ? `https:${src}` : src;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Exact-host lookup with a www fallback. Deliberately conservative:
 * no suffix matching, because public CDNs (jsdelivr, unpkg, shopify CDN)
 * host many unrelated vendors and a wrong guess is worse than none.
 */
export function lookupVendor(host: string | null): VendorEntry | null {
  if (!host) return null;
  const map = loadMap();
  return map.get(host) ?? map.get(host.replace(/^www\./, '')) ?? null;
}
