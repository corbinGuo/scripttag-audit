/**
 * Storefront HTML scan (v0.4). This is the surface that sees ScriptTag API
 * objects created by OTHER apps: `scriptTags` is scoped to the calling app,
 * but injected tags are rendered into the storefront HTML. Works without any
 * Shopify credentials — public storefronts are enough for this surface.
 */
import { extractHost, lookupVendor } from './vendor-map.js';
import type { AppEmbedInfo, VendorConfidence } from './types.js';

// Plain browser UA: bot markers in the UA trigger JS challenges on some
// Shopify storefronts. We only read public storefront HTML.
const STOREFRONT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;

const TWO_PART_SUFFIXES = new Set([
  'co.uk',
  'co.nz',
  'co.jp',
  'co.kr',
  'co.in',
  'co.za',
  'com.au',
  'com.br',
  'com.cn',
  'com.hk',
  'com.mx',
  'com.sg',
  'com.tr',
]);

export interface StorefrontHit {
  id: string;
  src: string;
  host: string | null;
  vendor: string | null;
  vendorConfidence: VendorConfidence | null;
  vendorCategory: string | null;
  /** affected-storefront = likely ScriptTag-injected; appEmbed = theme app extension asset. */
  status: 'affected-storefront' | 'appEmbed';
  surface: 'storefront';
}

export interface StorefrontScan {
  hits: StorefrontHit[];
  notes: string[];
}

export function normalizeSrc(src: string): string {
  const decoded = src.replace(/&amp;/g, '&').trim();
  return decoded.startsWith('//') ? `https:${decoded}` : decoded;
}

function isAuditableSrc(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith('//');
}

export function isShopifyExtensionUrl(src: string): boolean {
  try {
    const u = new URL(src);
    return (
      (u.hostname === 'cdn.shopify.com' && u.pathname.startsWith('/extensions/')) ||
      u.hostname === 'extensions.shopifycdn.com'
    );
  } catch {
    return false;
  }
}

export function isShopifyFirstParty(src: string): boolean {
  try {
    const u = new URL(src);
    const h = u.hostname.toLowerCase();
    if (h === 'cdn.shopify.com') return !u.pathname.startsWith('/extensions/');
    return (
      h === 'shopify.com' ||
      h.endsWith('.shopify.com') ||
      h === 'shopifycloud.com' ||
      h.endsWith('.shopifycloud.com') ||
      h === 'shopifysvc.com' ||
      h.endsWith('.shopifysvc.com') ||
      h === 'shop.app'
    );
  } catch {
    return false;
  }
}

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length >= 3 && TWO_PART_SUFFIXES.has(parts.slice(-2).join('.'))) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function isSameSite(host: string, storefrontHost: string): boolean {
  if (!storefrontHost) return false;
  const h = host.toLowerCase();
  const s = storefrontHost.toLowerCase();
  if (h === s || h === `www.${s}` || s === `www.${h}`) return true;
  return registrableDomain(h) === registrableDomain(s);
}

export function extractStorefrontSrcs(html: string): string[] {
  const out: string[] = [];
  SCRIPT_SRC_RE.lastIndex = 0;
  for (let m = SCRIPT_SRC_RE.exec(html); m; m = SCRIPT_SRC_RE.exec(html)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (raw) out.push(normalizeSrc(raw));
  }
  return out;
}

export function looksLikeBotChallenge(html: string): boolean {
  // Deliberately narrow: many legitimate pages load a captcha widget, so a
  // bare "captcha" match would reject real storefronts.
  return (
    /cf-chl/.test(html) ||
    /<title>\s*Just a moment\.\.\./i.test(html) ||
    /Enable JavaScript and cookies to continue/i.test(html) ||
    /^local_rate_limited\s*$/m.test(html) ||
    /<title>\s*Access Denied/i.test(html) ||
    /Request unsuccessful/i.test(html) ||
    /Please verify you are a human/i.test(html) ||
    /Press & Hold/i.test(html) ||
    /Attention Required!\s*\|\s*Cloudflare/i.test(html)
  );
}

export function looksLikePasswordPage(html: string): boolean {
  const hasForm = /<form[^>]+action=["']\/password/i.test(html);
  const hasField = /name=["']password["']/i.test(html);
  return hasForm && hasField;
}

function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': STOREFRONT_UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function toHit(src: string): StorefrontHit | null {
  if (!isAuditableSrc(src)) return null;
  const host = extractHost(src);
  if (!host) return null;
  const vendor = lookupVendor(host);
  return {
    id: `storefront:${stableHash(src)}`,
    src,
    host,
    vendor: vendor?.vendor ?? null,
    vendorConfidence: vendor?.confidence ?? null,
    vendorCategory: vendor?.category ?? null,
    status: isShopifyExtensionUrl(src) ? 'appEmbed' : 'affected-storefront',
    surface: 'storefront',
  };
}

/**
 * Fetch the public storefront and classify third-party scripts. First-party
 * assets and same-site subdomains are dropped. `store` may be a custom domain
 * or a .myshopify.com domain.
 */
export async function fetchStorefrontScan(store: string): Promise<StorefrontScan> {
  const base = /^https?:\/\//i.test(store) ? store.replace(/\/+$/, '') : `https://${store.replace(/\/+$/, '')}`;
  const storefrontHost = new URL(base).hostname;
  const notes: string[] = [];

  const homepage = await fetchHtml(`${base}/`);
  if (looksLikeBotChallenge(homepage)) {
    throw new Error('storefront returned a bot challenge (try again later or from another network)');
  }
  if (looksLikePasswordPage(homepage)) {
    return {
      hits: [],
      notes: [
        'Storefront is password-protected; app-injected script tags could not be read. Re-run after the store is public.',
      ],
    };
  }

  const pages = [{ path: '/', html: homepage }];
  try {
    const collection = await fetchHtml(`${base}/collections/all`);
    if (!looksLikeBotChallenge(collection) && !looksLikePasswordPage(collection)) {
      pages.push({ path: '/collections/all', html: collection });
    }
  } catch {
    // Optional second page.
  }

  const bySrc = new Map<string, StorefrontHit>();
  for (const page of pages) {
    for (const raw of extractStorefrontSrcs(page.html)) {
      const src = normalizeSrc(raw);
      if (!isAuditableSrc(src) || bySrc.has(src)) continue;
      if (!isShopifyExtensionUrl(src) && isShopifyFirstParty(src)) continue;
      let host: string | null = null;
      try {
        host = new URL(src).hostname;
      } catch {
        continue;
      }
      if (!isShopifyExtensionUrl(src) && isSameSite(host, storefrontHost)) continue;
      const hit = toHit(src);
      if (hit) bySrc.set(src, hit);
    }
  }

  notes.push(
    `Storefront scan read ${pages.length} page${pages.length === 1 ? '' : 's'} (${pages
      .map((p) => p.path)
      .join(', ')}).`
  );
  return { hits: [...bySrc.values()], notes };
}

/** settings_data.json is JSON-with-comments in many themes. */
export function stripJsonComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** App embeds live under current.blocks, keyed by block id, with a type of
 * shopify://apps/<handle>/blocks/<block>. */
export function parseAppEmbeds(settingsData: string): AppEmbedInfo[] {
  const data = JSON.parse(stripJsonComments(settingsData)) as {
    current?: { blocks?: Record<string, { type?: string; disabled?: boolean }> };
  };
  const blocks = data.current?.blocks ?? {};
  const out: AppEmbedInfo[] = [];
  for (const [blockId, block] of Object.entries(blocks)) {
    const type = block?.type;
    if (typeof type !== 'string') continue;
    const match = type.match(/^shopify:\/\/apps\/([^/]+)\/blocks\/([^/]+)/);
    if (!match) continue;
    out.push({ blockId, handle: match[1], type, disabled: block.disabled === true });
  }
  return out;
}
