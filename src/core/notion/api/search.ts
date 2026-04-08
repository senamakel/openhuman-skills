// Notion Search API — POST /v1/search with query, filter, sort, page_size
import type { SearchResponse } from '@notionhq/client/build/src/api-endpoints';

import { apiFetch } from './client';

export interface SearchRequest {
  query?: string;
  filter?: { property: string; value: string };
  sort?: { direction: 'ascending' | 'descending'; timestamp: 'last_edited_time' };
  page_size?: number;
  start_cursor?: string;
}

export function search(body: SearchRequest | Record<string, unknown>): SearchResponse {
  return apiFetch<SearchResponse>('/search', { method: 'POST', body });
}
