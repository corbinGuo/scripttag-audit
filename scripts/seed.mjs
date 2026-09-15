// Seed script tags in the dev store — MUST run before 2026-10-01, after
// which scriptTagCreate is permanently disabled (all API versions).
// Usage:
//   CLIENT_ID=xxx CLIENT_SECRET=yyy node scripts/seed.mjs
// Optional: SHOP=your-store.myshopify.com
import { mintToken } from '../dist/auth.js';

const SHOP = process.env.SHOP ?? 'tagguard-dev.myshopify.com';
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set CLIENT_ID and CLIENT_SECRET env vars first.');
  process.exit(1);
}

// One seed per classification branch:
//   ONLINE_STORE -> AFFECTED (web-pixel advice expected: hotjar)
//   ALL          -> AFFECTED (app-embed advice expected: intercom)
//   ORDER_STATUS -> DEAD (cleanup)
const SEEDS = [
  { src: 'https://cdn.hotjar.com/hotjar-example.js', displayScope: 'ONLINE_STORE' },
  { src: 'https://widget.intercom.io/intercom-example.js', displayScope: 'ALL' },
  { src: 'https://embed.tawk.to/tawk-example.js', displayScope: 'ORDER_STATUS' },
];

const token = await mintToken(SHOP, CLIENT_ID, CLIENT_SECRET);
console.log('token minted OK');

const API = '2026-07';
for (const s of SEEDS) {
  // JSON.stringify produces the properly quoted GraphQL string literal.
  const query =
    `mutation { scriptTagCreate(input: { src: ${JSON.stringify(s.src)}, ` +
    `displayScope: ${s.displayScope} }) { scriptTag { id src displayScope createdAt } ` +
    `userErrors { field message } } }`;
  try {
    const res = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query }),
    });
    const body = await res.json();
    const r = body.data?.scriptTagCreate;
    if (!r) {
      console.log(`[${s.displayScope}] TRANSPORT/GraphQL ERROR:`, JSON.stringify(body).slice(0, 400));
      continue;
    }
    if (r.userErrors?.length) {
      console.log(`[${s.displayScope}] USER_ERRORS:`, JSON.stringify(r.userErrors));
    } else {
      console.log(`[${s.displayScope}] CREATED:`, JSON.stringify(r.scriptTag));
    }
  } catch (err) {
    console.log(`[${s.displayScope}] NETWORK ERROR:`, err?.message ?? String(err));
  }
}
console.log('done. Next: node dist/index.js scan --store ' + SHOP + ' --client-id ... --client-secret ...');
