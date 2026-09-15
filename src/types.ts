export type TagStatus = 'affected-storefront' | 'dead-order-status' | 'unknown';

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
  replacement: 'web-pixel' | 'app-embed' | 'cleanup' | 'ask-vendor';
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
}

export interface ScanSummary {
  total: number;
  affected: number;
  dead: number;
  unknown: number;
  topVendors: { vendor: string; count: number }[];
}

export interface ScanReport {
  store: string;
  apiVersion: string;
  scannedAt: string;
  tags: EnrichedTag[];
  summary: ScanSummary;
}
