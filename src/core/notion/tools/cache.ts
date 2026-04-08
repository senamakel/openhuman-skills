// Shared cache freshness check for tools with tryCache support.
import { getNotionSkillState } from '../state';

/** Cache is considered fresh if last sync was within this many ms. */
const CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * Returns true if the local cache is fresh enough to serve results.
 * Cache is fresh when lastSyncTime is set and within CACHE_MAX_AGE_MS.
 */
export function isCacheFresh(): boolean {
  const s = getNotionSkillState();
  const lastSync = s.syncStatus.lastSyncTime;
  if (!lastSync) return false;
  return Date.now() - lastSync < CACHE_MAX_AGE_MS;
}
