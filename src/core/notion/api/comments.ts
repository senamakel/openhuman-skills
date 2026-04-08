// Notion Comments API
import type {
  CreateCommentResponse,
  ListCommentsResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { apiFetch } from './client';

export function createComment(body: Record<string, unknown>): CreateCommentResponse {
  return apiFetch<CreateCommentResponse>('/comments', { method: 'POST', body });
}

export function listComments(blockId: string, pageSize: number = 20): ListCommentsResponse {
  return apiFetch<ListCommentsResponse>(`/comments?block_id=${blockId}&page_size=${pageSize}`);
}
