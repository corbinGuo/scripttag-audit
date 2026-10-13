// Offline smoke test: exercises classification, vendor mapping, renderers,
// the advise pipeline, and OAuth HMAC verification — without touching the
// network. Run: node scripts/smoke.mjs
import { buildReport } from '../dist/report-builder.js';
import { renderTable, renderJson, renderCsv } from '../dist/report.js';
import { vendorCount, lookupVendor } from '../dist/vendor-map.js';
import { verifyCallbackHmac } from '../dist/oauth.js';
import { buildAdviceDoc, renderAdviceText, renderAdviceMarkdown, renderVendorEmails } from '../dist/advise-core.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

const tags = [
  {
    id: '1',
    src: 'https://cdn.hotjar.com/11/hotjar.js',
    displayScope: 'ONLINE_STORE',
    createdAt: '2024-03-01T10:00:00Z',
    updatedAt: '2024-03-01T10:00:00Z',
  },
  {
    id: '2',
    src: 'https://widget.intercom.io/widget/abc123',
    displayScope: 'ALL',
    createdAt: '2023-08-12T10:00:00Z',
    updatedAt: '2023-08-12T10:00:00Z',
  },
  {
    id: '3',
    src: 'https://embed.tawk.to/5f/1.js',
    displayScope: 'ORDER_STATUS',
    createdAt: '2022-01-05T10:00:00Z',
    updatedAt: '2022-01-05T10:00:00Z',
  },
  {
    id: '4',
    src: 'https://some-unknown-cdn.example.net/loader.js',
    displayScope: 'ONLINE_STORE',
    createdAt: '2025-06-20T10:00:00Z',
    updatedAt: '2025-06-20T10:00:00Z',
  },
  {
    id: '5',
    src: '//malformed-no-proto',
    displayScope: 'ONLINE_STORE',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: '6',
    src: 'https://code.tidio.co/abc.js',
    displayScope: 'ONLINE_STORE',
    createdAt: '2025-02-01T00:00:00Z',
    updatedAt: '2025-02-01T00:00:00Z',
  },
];

const report = buildReport('demo-store.myshopify.com', '2026-07', tags);

console.log(renderTable(report));
console.log('--- CSV preview (first 3 lines) ---');
console.log(renderCsv(report).split('\n').slice(0, 3).join('\n'));
console.log('--- JSON sanity ---');
const json = JSON.parse(renderJson(report));
console.log(
  'affected:', json.summary.affected,
  '| dead:', json.summary.dead,
  '| unknown:', json.summary.unknown,
  '| topVendors:', JSON.stringify(json.summary.topVendors)
);

const failures = [];
if (json.summary.affected !== 5) failures.push('affected count expected 5 (tags 1,2,4,5,6)');
if (json.summary.dead !== 1) failures.push('dead count expected 1');
if (json.summary.topVendors[0]?.vendor !== 'Hotjar') failures.push('top vendor expected Hotjar');
const malformed = json.tags.find((t) => t.id === '5');
// "//malformed-no-proto" is a valid protocol-relative URL once https: is
// prepended, so the host is extractable — null host is reserved for
// truly unparseable src values.
if (malformed.host !== 'malformed-no-proto') failures.push('protocol-relative src should yield its host');
if (json.tags.find((t) => t.id === '4').advice.replacement !== 'app-embed') {
  failures.push('unknown vendor should default to app-embed advice');
}
if (json.tags.find((t) => t.id === '1').advice.replacement !== 'web-pixel') {
  failures.push('Hotjar (Session Recording) should map to web-pixel');
}

// --- theme surface (V3, v0.3.0) ---
const themeHits = [
  { id: 'theme:1a2b3c4d', src: 'https://code.jquery.com/jquery-3.7.1.min.js', sourceFile: 'layout/theme.liquid' },
  { id: 'theme:deadbeef', src: '//cdn.example-widgets.io/chat.js', sourceFile: 'snippets/footer.liquid' },
];
const reportV3 = buildReport('demo-store.myshopify.com', '2026-07', tags, themeHits);
const jsonV3 = JSON.parse(renderJson(reportV3));
if (jsonV3.summary.theme !== 2) failures.push('theme count expected 2');
if (jsonV3.summary.affected !== 5) failures.push('affected must exclude theme rows (expected 5)');
if (jsonV3.summary.total !== 8) failures.push('total expected 8 (6 api + 2 theme)');
const themeTag = jsonV3.tags.find((t) => t.surface === 'theme' && t.id === 'theme:1a2b3c4d');
if (!themeTag || themeTag.advice.replacement !== 'theme-embed') failures.push('theme row should carry theme-embed advice');
if (themeTag.sourceFile !== 'layout/theme.liquid') failures.push('sourceFile missing on theme row');
if (themeTag.displayScope !== 'THEME') failures.push('theme row displayScope should be THEME');
const protoTheme = jsonV3.tags.find((t) => t.id === 'theme:deadbeef');
if (protoTheme.src !== 'https://cdn.example-widgets.io/chat.js') failures.push('protocol-relative theme src should be normalized');
const tableV3 = renderTable(reportV3);
if (!tableV3.includes('THEME (embed)') || !tableV3.includes('FOUND IN') || !tableV3.includes('layout/theme.liquid')) {
  failures.push('table render missing theme markers');
}
if (!tableV3.includes(`Theme: 2`)) failures.push('table summary missing Theme count');
const adviceDocV3 = buildAdviceDoc(reportV3);
if (adviceDocV3.counts.theme !== 2) failures.push('advice counts.theme expected 2');
if (!renderAdviceText(adviceDocV3).includes('Theme: 2')) failures.push('advice text missing Theme count');
if (!renderAdviceMarkdown(adviceDocV3).includes('theme: 2')) failures.push('advice md missing theme count');
const themeAdvice = adviceDocV3.groups.find((g) => g.items.some((i) => i.tag.surface === 'theme'));
if (!themeAdvice || themeAdvice.items.some((i) => i.steps[0] !== 'Not affected by the deprecation — theme-embedded scripts keep running.')) {
  failures.push('theme-embed steps missing');
}

// --- vendor mapping ---
const count = vendorCount();
console.log('--- vendor mapping:', count, 'entries ---');
if (count < 50) failures.push(`vendor mapping expected >= 50 entries, got ${count}`);
if (lookupVendor('code.tidio.co')?.vendor !== 'Tidio') failures.push('code.tidio.co should map to Tidio');
if (lookupVendor('www.googletagmanager.com')?.vendor !== 'Google') failures.push('gtm host should map to Google');
if (lookupVendor(null) !== null) failures.push('null host lookup must be null');

// --- OAuth callback HMAC ---
const secret = 'smoke-test-secret';
const params = { code: 'abc', shop: 'demo-store.myshopify.com', state: 'xyz', timestamp: '1757928000' };
params.hmac = createHmac('sha256', secret)
  .update(
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&')
  )
  .digest('hex');
if (!verifyCallbackHmac(params, secret)) failures.push('valid oauth hmac rejected');
if (verifyCallbackHmac({ ...params, hmac: '0'.repeat(64) }, secret)) failures.push('tampered oauth hmac accepted');
if (verifyCallbackHmac({ code: 'abc' }, secret)) failures.push('missing hmac must fail');

// --- advise pipeline (uses the real dev-store fixture) ---
const fixturePath = fileURLToPath(new URL('../fixtures/dev-store-snapshot.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const adviceDoc = buildAdviceDoc(fixture);
const adviceText = renderAdviceText(adviceDoc);
const adviceMd = renderAdviceMarkdown(adviceDoc);
const emails = renderVendorEmails(adviceDoc, fixture);
console.log('--- advise ---');
console.log(adviceText.split('\n').slice(0, 4).join('\n'));

if (adviceDoc.store !== fixture.store) failures.push('advice doc store mismatch');
if (adviceDoc.counts.total !== fixture.summary.total) failures.push('advice counts.total mismatch');
if (adviceDoc.counts.theme !== (fixture.summary.theme ?? 0)) failures.push('advice counts.theme mismatch on legacy fixture');
if (!adviceText.includes('Migration plan')) failures.push('advice text missing header');
if (!adviceMd.includes('# Migration plan')) failures.push('advice markdown missing header');
if (emails && !emails.includes('Subject:')) failures.push('emails missing Subject line');
console.log('email previews:', emails.split('Subject:').length - 1);

// --- profile storage round-trip (sandboxed config dir) ---
process.env.SCRIPTTAG_AUDIT_CONFIG_DIR = fileURLToPath(new URL('../.smoke-config', import.meta.url));
const { rmSync } = await import('node:fs');
rmSync(process.env.SCRIPTTAG_AUDIT_CONFIG_DIR, { recursive: true, force: true });
const { saveProfile, getProfile, deleteProfile, listShops } = await import('../dist/config.js');
saveProfile({ shop: 'smoke-store.myshopify.com', clientId: 'cid', clientSecret: 'sec', accessToken: 'tok' });
const roundTripped = getProfile('smoke-store.myshopify.com');
if (roundTripped?.clientSecret !== 'sec') failures.push('profile round-trip failed');
if (listShops()[0] !== 'smoke-store.myshopify.com') failures.push('listShops failed');
if (!deleteProfile('smoke-store.myshopify.com')) failures.push('deleteProfile failed');
if (getProfile('smoke-store.myshopify.com') !== null) failures.push('profile not deleted');
rmSync(process.env.SCRIPTTAG_AUDIT_CONFIG_DIR, { recursive: true, force: true });

if (failures.length) {
  console.error('SMOKE FAIL:', failures.join('; '));
  process.exit(1);
}
console.log('SMOKE OK');
