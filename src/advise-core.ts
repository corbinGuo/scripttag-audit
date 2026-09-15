import type { EnrichedTag, MigrationAdvice, ScanReport } from './types.js';
import { DEADLINE_API_BREAK, DEADLINE_STOREFRONT } from './analysis/classify.js';

/* ---------- doc anchors (TODO-VERIFY: anchors may move) ---------- */

export const DOC_WEB_PIXEL =
  'https://shopify.dev/docs/apps/build/marketing-analytics/build-web-pixel';
export const DOC_THEME_APP_EXT =
  'https://shopify.dev/docs/apps/build/online-store/theme-app-extensions';
export const DOC_SCRIPT_TAG_DELETE =
  'https://shopify.dev/docs/api/admin-graphql/latest/mutations/scriptTagDelete';

export const APP_EMBED_SCAFFOLD = `# shopify.app.toml
[[extensions]]
type = "theme"
name = "Feature embed"
handle = "feature-embed"

# extensions/feature-embed/blocks/embed.liquid — app embed block
{% schema %}
  { "name": "Feature", "target": "body", "settings": [] }
{% endschema %}
<script>
  // widget bootstrap moved out of the script tag — no document.write
</script>`;

export const WEB_PIXEL_SCAFFOLD = `# shopify.app.toml
[[extensions]]
type = "web_pixel_extension"
name = "analytics-pixel"

# extensions/web-pixel/src/index.js — sandboxed pixel (no DOM access)
api.analytics.subscribe('product_viewed', (event) => { /* forward */ });`;

function cleanupMutation(tagId: string): string {
  return `mutation DeleteScriptTag($id: ID!) {
  scriptTagDelete(id: $id) {
    deletedScriptTagId
    userErrors { field message }
  }
}
# variables: { "id": "${tagId}" }`;
}

/* ---------- doc model ---------- */

export interface AdviceItem {
  tag: EnrichedTag;
  replacement: MigrationAdvice['replacement'];
  steps: string[];
  scaffold: string | null;
  docUrl: string;
}

export interface AdviceGroup {
  /** Vendor display name, or "Unattributed host" when unmapped. */
  vendor: string;
  category: string | null;
  items: AdviceItem[];
}

export interface AdviceDoc {
  store: string;
  apiVersion: string;
  scannedAt: string;
  counts: { total: number; affected: number; dead: number; unknown: number };
  groups: AdviceGroup[];
}

function stepsFor(replacement: MigrationAdvice['replacement']): string[] {
  switch (replacement) {
    case 'web-pixel':
      return [
        'Vendor: rebuild the tracking in a web pixel extension (sandboxed, consent-aware).',
        'Vendor: stop calling scriptTagCreate once the pixel ships.',
        'You: nothing — once the vendor updates their app, ask them to confirm you can delete the old tag.',
      ];
    case 'app-embed':
      return [
        'Vendor: move the feature into a theme app extension with an app embed block; stop creating script tags.',
        'You: after the vendor ships, activate the embed: Online store → Themes → Customize → App embeds → toggle on.',
        'You: repeat the activation per theme — app embeds are per-theme; re-check after any theme change.',
      ];
    case 'cleanup':
      return [
        'Already dead (order status scripts were retired earlier by Shopify).',
        'You: delete it to reduce clutter — scriptTagDelete keeps working after the deadlines.',
      ];
    default:
      return [
        'This host is not in the vendor mapping — the tag may be from a theme, a custom integration, or an unknown app.',
        'You: identify the source (installed-app list in admin, theme.liquid, or ask your agency), then follow the web pixel / app embed path.',
        'Use `advise --email` for a ready-to-send inquiry to a suspected vendor.',
      ];
  }
}

function docUrlFor(replacement: MigrationAdvice['replacement']): string {
  switch (replacement) {
    case 'web-pixel':
      return DOC_WEB_PIXEL;
    case 'app-embed':
      return DOC_THEME_APP_EXT;
    case 'cleanup':
      return DOC_SCRIPT_TAG_DELETE;
    default:
      return DOC_THEME_APP_EXT;
  }
}

function scaffoldFor(
  replacement: MigrationAdvice['replacement'],
  tagId: string
): string | null {
  switch (replacement) {
    case 'web-pixel':
      return WEB_PIXEL_SCAFFOLD;
    case 'app-embed':
      return APP_EMBED_SCAFFOLD;
    case 'cleanup':
      return cleanupMutation(tagId);
    default:
      return null;
  }
}

export function buildAdviceDoc(report: ScanReport): AdviceDoc {
  const groups = new Map<string, AdviceGroup>();

  // Deterministic order: mapped vendors first (alphabetical), then
  // unattributed hosts by host.
  const sorted = [...report.tags].sort((a, b) => {
    const va = a.vendor ?? `~${a.host ?? a.src}`;
    const vb = b.vendor ?? `~${b.host ?? b.src}`;
    return va.localeCompare(vb);
  });

  for (const tag of sorted) {
    const key = tag.vendor ?? `host:${tag.host ?? 'unknown'}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        vendor: tag.vendor ?? 'Unattributed host',
        category: tag.vendorCategory ?? null,
        items: [],
      };
      groups.set(key, group);
    }
    const replacement = tag.advice.replacement;
    group.items.push({
      tag,
      replacement,
      steps: stepsFor(replacement),
      scaffold: scaffoldFor(replacement, tag.id),
      docUrl: docUrlFor(replacement),
    });
  }

  const counts = {
    total: report.summary.total,
    affected: report.summary.affected,
    dead: report.summary.dead,
    unknown: report.summary.unknown,
  };

  return {
    store: report.store,
    apiVersion: report.apiVersion,
    scannedAt: report.scannedAt,
    counts,
    groups: [...groups.values()],
  };
}

/* ---------- renderers ---------- */

const REPLACEMENT_LABEL: Record<MigrationAdvice['replacement'], string> = {
  'web-pixel': 'web pixel (vendor-side migration, no merchant action)',
  'app-embed': 'app embed block (vendor migration + you activate per theme)',
  cleanup: 'cleanup — delete the tag',
  'ask-vendor': 'verify with the vendor first',
};

function emailForGroup(group: AdviceGroup, report: ScanReport, unattributed: boolean): string {
  const lines: string[] = [];
  const subject = unattributed
    ? `Identify a script tag on ${report.store} (Shopify script tag deprecation)`
    : `Script tag migration before 2027-03-01 — ${report.store}`;
  lines.push(`Subject: ${subject}`);
  lines.push('');
  lines.push(`Hi ${unattributed ? 'there' : `${group.vendor} team`},`);
  lines.push('');
  lines.push(
    `We run the Shopify store ${report.store}. An audit of our storefront script tags ` +
      `(npx scripttag-audit) found ${group.items.length} tag(s)` +
      (unattributed
        ? ' that we could not attribute to an app:'
        : ` associated with ${group.vendor}:`)
  );
  lines.push('');
  for (const { tag } of group.items) {
    lines.push(
      `  - ${tag.src} (displayScope: ${tag.displayScope}, created ${tag.createdAt.slice(0, 10)})`
    );
  }
  lines.push('');
  lines.push(
    'Shopify is deprecating script tags (https://shopify.dev/changelog/online-store-script-tags-deprecation):'
  );
  lines.push(
    `  - After ${DEADLINE_API_BREAK}, scriptTagCreate fails — apps still using script tags can no longer be installed on new stores.`
  );
  lines.push(`  - On ${DEADLINE_STOREFRONT}, all script tags stop running on storefronts.`);
  lines.push('');
  if (unattributed) {
    lines.push(
      'Could you confirm whether this script tag belongs to your app, and if so, your migration plan (web pixel extension or app embed block)?'
    );
  } else {
    lines.push('Could you confirm:');
    lines.push(
      '  1. Your migration plan for these tags: web pixel extension (analytics) or app embed block (visible widgets)?'
    );
    lines.push(
      '  2. Whether merchants need to take any action (e.g. activate an app embed per theme), or it is fully automatic.'
    );
    lines.push('  3. When the updated version will be available.');
  }
  lines.push('');
  lines.push('Thank you!');
  return lines.join('\n');
}

export function renderAdviceText(doc: AdviceDoc): string {
  const out: string[] = [];
  out.push('');
  out.push(`Migration plan — ${doc.store}  (API ${doc.apiVersion}, scanned ${doc.scannedAt})`);
  out.push(
    `Affected: ${doc.counts.affected}   Dead: ${doc.counts.dead}   Unknown: ${doc.counts.unknown}   Total: ${doc.counts.total}`
  );
  if (doc.counts.affected > 0) {
    out.push(
      `Storefront tags stop running ${DEADLINE_STOREFRONT}; new installs break after ${DEADLINE_API_BREAK}.`
    );
  }
  out.push('');

  if (doc.groups.length === 0) {
    out.push('Nothing to migrate — the report contains no tags.');
    out.push('');
    return out.join('\n');
  }

  for (const group of doc.groups) {
    out.push(
      `── ${group.vendor} (${group.items.length} tag${group.items.length > 1 ? 's' : ''}) ` +
        '─'.repeat(24)
    );
    for (const item of group.items) {
      out.push(`  [${item.replacement}] ${item.tag.src}`);
      out.push(`      ${REPLACEMENT_LABEL[item.replacement]}`);
      item.steps.forEach((s, i) => out.push(`      ${i + 1}. ${s}`));
      out.push(`      Docs: ${item.docUrl}`);
      if (item.scaffold) {
        out.push('');
        out.push('      Skeleton (calibrate against current docs):');
        for (const line of item.scaffold.split('\n')) {
          out.push(`        ${line}`);
        }
      }
      out.push('');
    }
  }

  out.push('Tip: `advise --email` prints ready-to-send vendor inquiry emails.');
  out.push('');
  return out.join('\n');
}

export function renderAdviceMarkdown(doc: AdviceDoc): string {
  const out: string[] = [];
  out.push(`# Migration plan — ${doc.store}`);
  out.push('');
  out.push(
    `> API ${doc.apiVersion}, scanned ${doc.scannedAt}. Affected: **${doc.counts.affected}**, dead: ${doc.counts.dead}, unknown: ${doc.counts.unknown}.`
  );
  if (doc.counts.affected > 0) {
    out.push(
      `> Storefront tags stop running **${DEADLINE_STOREFRONT}**; new installs break after **${DEADLINE_API_BREAK}**.`
    );
  }
  out.push('');
  for (const group of doc.groups) {
    out.push(`## ${group.vendor} (${group.items.length})`);
    out.push('');
    for (const item of group.items) {
      out.push(`### \`${item.tag.src}\``);
      out.push('');
      out.push(`- **Migration path:** ${REPLACEMENT_LABEL[item.replacement]}`);
      out.push(`- **Scope:** \`${item.tag.displayScope}\`, id \`${item.tag.id}\``);
      out.push('');
      item.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
      out.push('');
      out.push(`Docs: ${item.docUrl}`);
      if (item.scaffold) {
        out.push('');
        out.push('```');
        out.push(item.scaffold);
        out.push('```');
      }
      out.push('');
    }
  }
  return out.join('\n');
}

export function renderVendorEmails(doc: AdviceDoc, report: ScanReport): string {
  const parts: string[] = [];
  for (const group of doc.groups) {
    const hasAffected = group.items.some((i) => i.tag.status === 'affected-storefront');
    const unattributed = group.vendor === 'Unattributed host';
    if (!hasAffected) continue; // dead/unknown tags are not worth a vendor email
    parts.push(emailForGroup(group, report, unattributed));
  }
  return parts.join('\n\n' + '─'.repeat(60) + '\n\n') + (parts.length ? '\n' : '');
}
