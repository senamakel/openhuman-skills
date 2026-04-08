// Notion Blocks API
import type {
  AppendBlockChildrenResponse,
  DeleteBlockResponse,
  GetBlockResponse,
  ListBlockChildrenResponse,
  UpdateBlockResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { apiFetch } from './client';

export function getBlock(blockId: string): GetBlockResponse {
  return apiFetch<GetBlockResponse>(`/blocks/${blockId}`);
}

export function getBlockChildren(
  blockId: string,
  pageSize: number = 50
): ListBlockChildrenResponse {
  return apiFetch<ListBlockChildrenResponse>(`/blocks/${blockId}/children?page_size=${pageSize}`);
}

export function appendBlockChildren(
  blockId: string,
  children: unknown[]
): AppendBlockChildrenResponse {
  return apiFetch<AppendBlockChildrenResponse>(`/blocks/${blockId}/children`, {
    method: 'PATCH',
    body: { children },
  });
}

export function updateBlock(blockId: string, body: Record<string, unknown>): UpdateBlockResponse {
  return apiFetch<UpdateBlockResponse>(`/blocks/${blockId}`, { method: 'PATCH', body });
}

export function deleteBlock(blockId: string): DeleteBlockResponse {
  return apiFetch<DeleteBlockResponse>(`/blocks/${blockId}`, { method: 'DELETE' });
}
