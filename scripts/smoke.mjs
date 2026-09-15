// Offline smoke test: exercises classification, vendor mapping, and all
// three renderers without touching the network. Run: node scripts/smoke.mjs
import { buildReport } from '../dist/report-builder.js';
import { renderTable, renderJson, renderCsv } from '../dist/report.js';

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
if (json.summary.affected !== 4) failures.push('affected count expected 4 (tags 1,2,4,5)');
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

if (failures.length) {
  console.error('SMOKE FAIL:', failures.join('; '));
  process.exit(1);
}
console.log('SMOKE OK');
