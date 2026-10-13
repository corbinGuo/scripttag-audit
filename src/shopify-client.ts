import type { ScriptTag } from './types.js';

const QUERY = /* GraphQL */ `
  query ScriptTags($cursor: String) {
    scriptTags(first: 100, after: $cursor) {
      edges {
        node {
          id
          src
          displayScope
          createdAt
          updatedAt
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export class ShopifyError extends Error {
  constructor(
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = 'ShopifyError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gql(
  shop: string,
  token: string,
  apiVersion: string,
  query: string,
  variables: Record<string, unknown>,
  attempt = 0
): Promise<any> {
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? ` (${err.cause.message})`
        : '';
    throw new ShopifyError(
      `Network request to ${shop} failed: ${
        err instanceof Error ? err.message : String(err)
      }${cause}`
    );
  }

  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '2');
    await sleep(Math.min(retryAfter, 10) * 1000);
    return gql(shop, token, apiVersion, query, variables, attempt + 1);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ShopifyError(
      `Authentication failed (HTTP ${res.status}).`,
      'Check that the access token is valid and that its app has the read_script_tags and read_themes scopes.'
    );
  }
  if (!res.ok) {
    throw new ShopifyError(`Shopify API returned HTTP ${res.status} for ${shop}.`);
  }

  const body = (await res.json()) as { data?: any; errors?: { message: string }[] };
  if (body.errors?.length) {
    const msgs = body.errors.map((e) => e.message).join('; ');
    const scopeProblem = /access denied|scope|unauthorized/i.test(msgs);
    throw new ShopifyError(
      `GraphQL error: ${msgs}`,
      scopeProblem
        ? 'The token likely lacks the read_script_tags or read_themes scope. Recreate/refresh the token with both scopes.'
        : undefined
    );
  }
  return body.data;
}

export async function fetchAllScriptTags(
  shop: string,
  token: string,
  apiVersion: string
): Promise<ScriptTag[]> {
  const tags: ScriptTag[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data = await gql(shop, token, apiVersion, QUERY, { cursor });
    const conn = data?.scriptTags;
    if (!conn || !Array.isArray(conn.edges)) {
      throw new ShopifyError(
        'Unexpected API response: scriptTags connection missing.',
        'This can happen with older API versions. Try --api-version 2026-07.'
      );
    }
    for (const edge of conn.edges) tags.push(edge.node as ScriptTag);
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return tags;
}

// --- theme file scan (V3, aligns with app/app/scan.server.ts) ---
//
// `scriptTags` returns ONLY the tags the calling app itself created (Shopify
// docs: "Script tags are scoped to the app that created them"), and since
// 2026-10-01 scriptTagCreate fails on every API version — so scripts added by
// merchants/agencies live in theme liquid files, which the ScriptTag API
// never sees. The theme scan reads the ACTIVE theme's .liquid files and
// extracts absolute-URL <script src> references. These keep running after
// 2027-03-01 (the deprecation only kills API-injected tags).

interface ThemeFilePage {
  nodes: { filename: string; body?: { content?: string } }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const THEMES_QUERY = /* GraphQL */ `
  query Themes {
    themes(first: 20) {
      edges { node { id name role } }
    }
  }
`;

// 2026-07 API: file body rides directly on theme.files.nodes (the standalone
// themeFiles(files:…) read query is gone from this version).
const THEME_FILES_QUERY = /* GraphQL */ `
  query ThemeFiles($id: ID!, $cursor: String) {
    theme(id: $id) {
      files(first: 20, after: $cursor) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText { content }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const SCRIPT_SRC_RE = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const MAX_LIQUID_FILES = 500;

/** Absolute http(s) or protocol-relative srcs only — liquid `{{ asset_url }}`
 * interpolations and relative paths are first-party theme assets. */
function isAuditableSrc(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith('//');
}

function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ThemeHit {
  id: string;
  src: string;
  sourceFile: string;
}

export async function fetchThemeScripts(
  shop: string,
  token: string,
  apiVersion: string
): Promise<ThemeHit[]> {
  // 1. Active theme.
  const themesData = await gql(shop, token, apiVersion, THEMES_QUERY, {});
  const themes = (themesData?.themes?.edges ?? []).map(
    (e: { node: { id: string; name: string; role: string } }) => e.node
  );
  const active =
    themes.find((t: { role: string }) => t.role.toLowerCase() === 'main') ?? themes[0];
  if (!active) return [];

  // 2. Stream .liquid files (with bodies) and extract absolute-URL script srcs.
  const bySrc = new Map<string, ThemeHit>();
  let cursor: string | null = null;
  let liquidSeen = 0;
  for (;;) {
    const data = await gql(shop, token, apiVersion, THEME_FILES_QUERY, {
      id: active.id,
      cursor,
    });
    const page = data?.theme?.files as ThemeFilePage | undefined;
    if (!page || !Array.isArray(page.nodes)) {
      throw new ShopifyError(
        'Unexpected API response: theme.files connection missing.',
        'This can happen with older API versions. Try --api-version 2026-07.'
      );
    }
    for (const node of page.nodes) {
      if (!node.filename.endsWith('.liquid')) continue;
      if (++liquidSeen > MAX_LIQUID_FILES) break;
      const content = node.body?.content;
      if (!content) continue; // unreadable body — not auditable
      SCRIPT_SRC_RE.lastIndex = 0;
      for (let m = SCRIPT_SRC_RE.exec(content); m; m = SCRIPT_SRC_RE.exec(content)) {
        const src = m[1];
        if (!isAuditableSrc(src) || bySrc.has(src)) continue;
        bySrc.set(src, {
          id: `theme:${stableHash(src)}`,
          src: src.startsWith('//') ? `https:${src}` : src,
          sourceFile: node.filename,
        });
      }
    }
    if (!page.pageInfo.hasNextPage || liquidSeen >= MAX_LIQUID_FILES) break;
    cursor = page.pageInfo.endCursor;
  }
  return [...bySrc.values()];
}

/** Both scan surfaces. Either one failing aborts the scan — a partial report
 * would silently under-report (the exact 2.1.1 review finding this fixes). */
export async function fetchAllScanRows(
  shop: string,
  token: string,
  apiVersion: string
): Promise<{ apiTags: ScriptTag[]; themeHits: ThemeHit[] }> {
  const [apiTags, themeHits] = await Promise.all([
    fetchAllScriptTags(shop, token, apiVersion),
    fetchThemeScripts(shop, token, apiVersion),
  ]);
  return { apiTags, themeHits };
}
