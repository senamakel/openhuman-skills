// Notion Databases API
import type {
  CreateDatabaseResponse,
  GetDatabaseResponse,
  GetDataSourceResponse,
  QueryDataSourceResponse,
  SearchResponse,
  UpdateDatabaseResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { formatApiError, getQueryEndpoint, resolveDataSourceId } from '../helpers';
import { apiFetch } from './client';

export function getDatabase(databaseId: string): GetDatabaseResponse {
  return apiFetch<GetDatabaseResponse>(`/databases/${databaseId}`);
}

export function resolveDataSourceIdCompat(databaseId: string): string {
  try {
    return resolveDataSourceId(databaseId);
  } catch (error) {
    throw new Error(
      `Database has no data sources or is not accessible. Share the database with your integration. ${formatApiError(error)}`
    );
  }
}

export function getDataSource(dataSourceId: string): GetDataSourceResponse {
  return apiFetch<GetDataSourceResponse>(`/data_sources/${dataSourceId}`);
}

export function queryDataSource(
  databaseId: string,
  body?: Record<string, unknown>
): QueryDataSourceResponse {
  const endpoint = getQueryEndpoint(databaseId);
  const requestBody = body || {};
  console.log(`[notion][databases] Querying ${endpoint}`);
  return apiFetch<QueryDataSourceResponse>(endpoint, { method: 'POST', body: requestBody });
}

export function createDatabase(body: Record<string, unknown>): CreateDatabaseResponse {
  return apiFetch<CreateDatabaseResponse>('/databases', { method: 'POST', body });
}

export function updateDatabase(
  databaseId: string,
  body: Record<string, unknown>
): UpdateDatabaseResponse {
  return apiFetch<UpdateDatabaseResponse>(`/databases/${databaseId}`, { method: 'PATCH', body });
}

export function listAllDatabases(pageSize: number = 20): SearchResponse {
  const filter = { property: 'object', value: 'data_source' };
  return apiFetch<SearchResponse>('/search', {
    method: 'POST',
    body: { filter, page_size: pageSize },
  });
}
