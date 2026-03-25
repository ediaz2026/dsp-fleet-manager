/**
 * syncService.js
 *
 * Two-way sync between Schedule (Weekly/Daily) and Ops Planner.
 * When either side changes data for a specific date, call the
 * appropriate notify function to invalidate the other side's cache.
 *
 * Sync rules:
 *  - Only affects the specific date being edited
 *  - No other dates are ever affected
 *  - Real-time: no page refresh needed (React Query refetches automatically)
 */
import { useQueryClient } from '@tanstack/react-query';

export function useSyncService() {
  const qc = useQueryClient();

  /**
   * Call after any Schedule (weekly/daily) change for a date.
   * Forces Ops Planner to refresh its data for that date.
   */
  function notifyScheduleChanged(dateStr) {
    if (!dateStr) return;
    qc.invalidateQueries({ queryKey: ['ops-plan-session', dateStr] });
    qc.invalidateQueries({ queryKey: ['ops-assignments', dateStr] });
    qc.invalidateQueries({ queryKey: ['ops-roster', dateStr] });
  }

  /**
   * Call after any Ops Planner change for a date.
   * Forces Schedule (weekly/daily) to refresh shifts for that date's week.
   */
  function notifyOpsChanged(dateStr) {
    if (!dateStr) return;
    // Invalidate all shifts queries — the weekly view will refetch its week
    qc.invalidateQueries({ queryKey: ['shifts'] });
    qc.invalidateQueries({ queryKey: ['week-status'] });
  }

  return { notifyScheduleChanged, notifyOpsChanged };
}
