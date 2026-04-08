// Shared type for Notion helper/API surface used by tools and sync
export interface NotionGlobals {
  notionFetch(endpoint: string, options?: { method?: string; body?: unknown }): Promise<unknown>;
  formatApiError(error: unknown): string;
  formatRichText(richText: unknown[]): string;
  formatPageTitle(page: Record<string, unknown>): string;
  formatPageSummary(page: Record<string, unknown>): Record<string, unknown>;
  formatDatabaseSummary(db: Record<string, unknown>): Record<string, unknown>;
  formatBlockSummary(block: Record<string, unknown>): Record<string, unknown>;
  formatBlockContent(block: Record<string, unknown>): string;
  formatUserSummary(user: Record<string, unknown>): Record<string, unknown>;
  buildRichText(text: string): unknown[];
  buildParagraphBlock(text: string): Record<string, unknown>;
  fetchBlockTreeText(blockId: string, maxDepth?: number): Promise<string>;
  getLocalPages(options?: { query?: string; limit?: number; includeArchived?: boolean }): unknown[];
  getLocalDatabases(options?: { query?: string; limit?: number }): unknown[];
  getLocalDatabaseRows(options?: {
    databaseId?: string;
    query?: string;
    limit?: number;
    includeArchived?: boolean;
  }): unknown[];
  getLocalUsers(): unknown[];
  getPageById(pageId: string): unknown | null;
  getEntityCounts(): {
    pages: number;
    databases: number;
    databaseRows: number;
    users: number;
    pagesWithContent: number;
    pagesWithSummary: number;
    summariesTotal: number;
    summariesPending: number;
  };
  getPagesNeedingSummary(limit: number): unknown[];
  getRowsNeedingSummary(limit: number): unknown[];
  getRowStructuredEntities(
    rowId: string
  ): Array<{ id: string; type: string; name?: string; role: string; property?: string }>;
  insertSummary(opts: {
    pageId: string;
    url?: string | null;
    summary: string;
    category?: string;
    sentiment?: string;
    entities?: unknown[];
    topics?: string[];
    metadata?: Record<string, unknown>;
    sourceCreatedAt: string;
    sourceUpdatedAt: string;
  }): void;
  getUnsyncedSummaries(limit: number): unknown[];
  markSummariesSynced(ids: number[]): void;
  performSync(): void;
}
