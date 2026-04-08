// Notion Pages API
import type {
  CreatePageResponse,
  GetPageResponse,
  ListBlockChildrenResponse,
  UpdatePageResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { apiFetch } from './client';

export function getPage(pageId: string): GetPageResponse {
  return apiFetch<GetPageResponse>(`/pages/${pageId}`);
}

export function createPage(body: Record<string, unknown>): CreatePageResponse {
  return apiFetch<CreatePageResponse>('/pages', { method: 'POST', body });
}

export function updatePage(pageId: string, body: Record<string, unknown>): UpdatePageResponse {
  return apiFetch<UpdatePageResponse>(`/pages/${pageId}`, { method: 'PATCH', body });
}

export function archivePage(pageId: string): UpdatePageResponse {
  return apiFetch<UpdatePageResponse>(`/pages/${pageId}`, {
    method: 'PATCH',
    body: { archived: true },
  });
}

export function getPageContent(pageId: string, pageSize: number = 50): ListBlockChildrenResponse {
  return apiFetch<ListBlockChildrenResponse>(`/blocks/${pageId}/children?page_size=${pageSize}`);
}
