import type { EnrichedTag, ScanReport } from './types.js';
import { DEADLINE_API_BREAK, DEADLINE_STOREFRONT } from './analysis/classify.js';

/* ---------- ANSI helpers (no dependency) ---------- */

const ansi =
  process.stdout.isTTY && !process.env.NO_COLOR
    ? (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`
    : (_code: string, s: string) => s;

const bold = (s: string) => ansi('1', s);
const dim = (s: string) => ansi('2', s);
const red = (s: string) => ansi('31', s);
const green = (s: string) => ansi('32', s);
const yellow = (s: string) => ansi('33', s);
const gray = (s: string) => ansi('90', s);

/* ---------- terminal table ---------- */

const STATUS_LABEL: Record<EnrichedTag['status'], string> = {
  'affected-storefront': 'AFFECTED',
  'dead-order-status': 'DEAD (cleanup)',
  unknown: 'UNKNOWN',
};

function statusColor(status: EnrichedTag['status'], s: string): string {
  if (status === 'affected-storefront') return red(s);
  if (status === 'dead-order-status') return yellow(s);
  return gray(s);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function pad(s: string, w: number): string {
  return s.padEnd(w);
}

export function renderTable(report: ScanReport): string {
  const lines: string[] = [];
  const { summary } = report;

  lines.push('');
  lines.push(
    bold(`Script tag audit — ${report.store}`) +
      dim(`  (API ${report.apiVersion}, ${report.scannedAt})`)
  );
  lines.push(gray('-'.repeat(76)));
  lines.push(
    [
      `Total: ${summary.total}`,
      red(`Affected: ${summary.affected}`),
      yellow(`Dead: ${summary.dead}`),
      gray(`Unknown: ${summary.unknown}`),
    ].join('   ')
  );
  if (summary.affected > 0) {
    lines.push(
      dim(
        `Storefront script tags stop running ${DEADLINE_STOREFRONT}; ` +
          `new installs break after ${DEADLINE_API_BREAK}.`
      )
    );
  }
  if (summary.topVendors.length > 0) {
    lines.push(
      'Suspected vendors: ' +
        summary.topVendors.map((v) => `${v.vendor} (${v.count})`).join(', ')
    );
  }
  lines.push('');

  if (report.tags.length === 0) {
    lines.push(green('No script tags found. Nothing to migrate.'));
    lines.push('');
    return lines.join('\n');
  }

  const headers = ['STATUS', 'SCOPE', 'HOST / VENDOR', 'CREATED', 'SRC'];
  const caps = [16, 14, 36, 10, 48];

  const rows = report.tags.map((t) => ({
    tag: t,
    cells: [
      STATUS_LABEL[t.status],
      truncate(t.displayScope, caps[1]),
      truncate(
        t.vendor ? `${t.host} → ${t.vendor} (${t.vendorConfidence})` : (t.host ?? '—'),
        caps[2]
      ),
      t.createdAt.slice(0, 10),
      truncate(t.src, caps[4]),
    ],
  }));

  const widths = caps.map((cap, i) =>
    Math.min(cap, Math.max(headers[i].length, ...rows.map((r) => r.cells[i].length)))
  );

  lines.push(headers.map((h, i) => bold(pad(h, widths[i]))).join('  '));
  lines.push(gray('-'.repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2)));

  for (const { tag, cells } of rows) {
    lines.push(
      [
        statusColor(tag.status, pad(cells[0], widths[0])),
        pad(cells[1], widths[1]),
        pad(cells[2], widths[2]),
        pad(cells[3], widths[3]),
        pad(cells[4], widths[4]),
      ].join('  ')
    );
  }
  lines.push('');

  if (summary.affected > 0) {
    lines.push(
      red(`${summary.affected} affected script tag(s) found — exiting with code 1 (CI gate).`)
    );
    lines.push(
      dim(
        'Fix: migrate to app embed blocks / web pixels, then re-run until exit code is 0.'
      )
    );
    lines.push('');
  }
  return lines.join('\n');
}

/* ---------- JSON ---------- */

export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}

/* ---------- CSV ---------- */

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS: { key: keyof EnrichedTag; header: string }[] = [
  { key: 'id', header: 'id' },
  { key: 'src', header: 'src' },
  { key: 'host', header: 'host' },
  { key: 'vendor', header: 'vendor' },
  { key: 'vendorConfidence', header: 'vendor_confidence' },
  { key: 'displayScope', header: 'display_scope' },
  { key: 'status', header: 'status' },
  { key: 'createdAt', header: 'created_at' },
  { key: 'updatedAt', header: 'updated_at' },
];

export function renderCsv(report: ScanReport): string {
  const header = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(',');
  const rows = report.tags.map((t) =>
    CSV_COLUMNS.map((c) => csvEscape(t[c.key])).join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}
