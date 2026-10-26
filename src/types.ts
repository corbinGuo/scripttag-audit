export type TagStatus =
  | 'affected-storefront'
  | 'dead-order-status'
  | 'unknown'
  /** Hard-coded <script src> in a theme .liquid file (second scan surface, V3). */
  | 'theme'
  /** Theme app extension asset seen in the storefront — keeps running. */
  | 'appEmbed';

export type ScanSurface = 'scriptTag' | 'storefront' | 'theme';

export type VendorConfidence = 'high' | 'medium' | 'low';

export interface ScriptTag {
  id: string;
  src: string;
  /**
   * Expected values: ONLINE_STORE | ORDER_STATUS | ALL
   * TODO-VERIFY (V1 in docs/system-design.md): confirm exact enum values in a dev store.
   */
  displayScope: string;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationAdvice {
  replacement: 'web-pixel' | 'app-embed' | 'cleanup' | 'ask-vendor' | 'theme-embed';
  summary: string;
  docUrl: string;
}

export interface EnrichedTag extends ScriptTag {
  host: string | null;
  vendor: string | null;
  vendorConfidence: VendorConfidence | null;
  /** Product category from the vendor mapping (drives the migration path). */
  vendorCategory: string | null;
  status: TagStatus;
  advice: MigrationAdvice;
  /** Which surface produced this row. Absent in pre-v0.3.0 reports (API tags). */
  surface?: ScanSurface;
  /** Theme .liquid file the script was found in (theme rows only). */
  sourceFile?: string | null;
}

export interface ScanSummary {
  total: number;
  affected: number;
  dead: number;
  unknown: number;
  /** Theme-embedded scripts — separate surface, keeps running post-deprecation. */
  theme: number;
  /** Scripts seen in the live storefront HTML (affected + app embed assets). */
  storefront: number;
  /** App embed assets inside the storefront count (not affected). */
  appEmbedAssets: number;
  topVendors: { vendor: string; count: number }[];
}

export interface AppEmbedInfo {
  blockId: string;
  handle: string;
  type: string;
  disabled: boolean;
}

export interface ScanReport {
  store: string;
  apiVersion: string;
  scannedAt: string;
  tags: EnrichedTag[];
  summary: ScanSummary;
  /** App embed blocks from config/settings_data.json (requires login). */
  appEmbeds?: AppEmbedInfo[];
  /** Partial-result warnings (password page, bot challenge, storefront-only). */
  notes?: string[];
}
