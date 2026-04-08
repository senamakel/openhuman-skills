// Centralized Notion API fetch resolver.
import { notionFetch } from '../helpers';

export function apiFetch<T>(endpoint: string, options?: { method?: string; body?: unknown }): T {
  return notionFetch<T>(endpoint, options);
}
