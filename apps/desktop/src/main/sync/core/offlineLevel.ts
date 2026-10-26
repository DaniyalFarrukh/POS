import type { OfflineLevelResult, OfflineWarningLevel } from './types';

/**
 * Computes the client offline duration and severity level based on the last known online timestamp.
 * Levels defined in docs/SYNC_CLIENT.md:
 * - ok: < 50%
 * - warning: 50% - < 80%
 * - critical: 80% - <= 100%
 * - exceeded: > 100%
 *
 * @param lastOnlineAt UTC ISO timestamp or Date when device was last online
 * @param now Current reference time (UTC ISO or Date)
 * @param maxOfflineHours Configuration limit in hours (default: 72)
 */
export function computeOfflineLevel(
  lastOnlineAt: string | Date | null | undefined,
  now: string | Date,
  maxOfflineHours = 72
): OfflineLevelResult {
  if (!lastOnlineAt) {
    return {
      level: 'ok',
      hoursOffline: 0,
      percentUsed: 0,
    };
  }

  const lastOnlineMs = new Date(lastOnlineAt).getTime();
  const nowMs = new Date(now).getTime();

  if (Number.isNaN(lastOnlineMs) || Number.isNaN(nowMs) || nowMs <= lastOnlineMs) {
    return {
      level: 'ok',
      hoursOffline: 0,
      percentUsed: 0,
    };
  }

  const hoursOffline = (nowMs - lastOnlineMs) / (1000 * 60 * 60);
  const effectiveMaxHours = Math.max(1, maxOfflineHours);
  const percentUsed = (hoursOffline / effectiveMaxHours) * 100;

  let level: OfflineWarningLevel = 'ok';
  if (percentUsed > 100) {
    level = 'exceeded';
  } else if (percentUsed >= 80) {
    level = 'critical';
  } else if (percentUsed >= 50) {
    level = 'warning';
  } else {
    level = 'ok';
  }

  return {
    level,
    hoursOffline,
    percentUsed,
  };
}
