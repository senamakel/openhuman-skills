// Notion Users API
import type { GetUserResponse, ListUsersResponse } from '@notionhq/client/build/src/api-endpoints';

import { apiFetch } from './client';

export function getUser(userId: string): GetUserResponse {
  return apiFetch<GetUserResponse>(`/users/${userId}`);
}

export function listUsers(pageSize: number = 20, startCursor?: string): ListUsersResponse {
  let endpoint = `/users?page_size=${pageSize}`;
  if (startCursor) endpoint += `&start_cursor=${startCursor}`;
  return apiFetch<ListUsersResponse>(endpoint);
}
