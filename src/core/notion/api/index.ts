// Barrel export for the Notion API layer.
import type {
  AppendBlockChildrenResponse,
  CreateCommentResponse,
  CreateDatabaseResponse,
  CreatePageResponse,
  DeleteBlockResponse,
  GetBlockResponse,
  GetDatabaseResponse,
  GetDataSourceResponse,
  GetPageResponse,
  GetUserResponse,
  ListBlockChildrenResponse,
  ListCommentsResponse,
  ListUsersResponse,
  QueryDataSourceResponse,
  SearchResponse,
  UpdateBlockResponse,
  UpdateDatabaseResponse,
  UpdatePageResponse,
} from '@notionhq/client/build/src/api-endpoints';

import {
  appendBlockChildren,
  deleteBlock,
  getBlock,
  getBlockChildren,
  updateBlock,
} from './blocks';
import { createComment, listComments } from './comments';
// Side-effect imports — trigger module initialization
import {
  createDatabase,
  getDatabase,
  getDataSource,
  listAllDatabases,
  queryDataSource,
  resolveDataSourceIdCompat,
  updateDatabase,
} from './databases';
import { archivePage, createPage, getPage, getPageContent, updatePage } from './pages';
import { search } from './search';
import { getUser, listUsers } from './users';

export interface NotionApi {
  // pages
  getPage(pageId: string): GetPageResponse;
  createPage(body: Record<string, unknown>): CreatePageResponse;
  updatePage(pageId: string, body: Record<string, unknown>): UpdatePageResponse;
  archivePage(pageId: string): UpdatePageResponse;
  getPageContent(pageId: string, pageSize?: number): ListBlockChildrenResponse;
  // databases
  getDatabase(databaseId: string): GetDatabaseResponse;
  resolveDataSourceId(databaseId: string): string;
  getDataSource(dataSourceId: string): GetDataSourceResponse;
  queryDataSource(databaseId: string, body?: Record<string, unknown>): QueryDataSourceResponse;
  createDatabase(body: Record<string, unknown>): CreateDatabaseResponse;
  updateDatabase(databaseId: string, body: Record<string, unknown>): UpdateDatabaseResponse;
  listAllDatabases(pageSize?: number): SearchResponse;
  // blocks
  getBlock(blockId: string): GetBlockResponse;
  getBlockChildren(blockId: string, pageSize?: number): ListBlockChildrenResponse;
  appendBlockChildren(blockId: string, children: unknown[]): AppendBlockChildrenResponse;
  updateBlock(blockId: string, body: Record<string, unknown>): UpdateBlockResponse;
  deleteBlock(blockId: string): DeleteBlockResponse;
  // users
  getUser(userId: string): GetUserResponse;
  listUsers(pageSize?: number, startCursor?: string): ListUsersResponse;
  // comments
  createComment(body: Record<string, unknown>): CreateCommentResponse;
  listComments(blockId: string, pageSize?: number): ListCommentsResponse;
  // search
  search(body: Record<string, unknown>): SearchResponse;
}

export const notionApi: NotionApi = {
  // pages
  getPage,
  createPage,
  updatePage,
  archivePage,
  getPageContent,
  // databases
  getDatabase,
  resolveDataSourceId: resolveDataSourceIdCompat,
  getDataSource,
  queryDataSource,
  createDatabase,
  updateDatabase,
  listAllDatabases,
  // blocks
  getBlock,
  getBlockChildren,
  appendBlockChildren,
  updateBlock,
  deleteBlock,
  // users
  getUser,
  listUsers,
  // comments
  createComment,
  listComments,
  // search
  search,
} as NotionApi;
