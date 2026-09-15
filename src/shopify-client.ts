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
      'Check that the access token is valid and that its app has the read_script_tags scope.'
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
        ? 'The token likely lacks the read_script_tags scope. Recreate/refresh the token with that scope.'
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
