/**
 * Filter operations for aggregate view.
 */

import * as errore from 'errore';
import type { PtyInfo } from './types';
import { FilterOperationError } from './errors';

export function normalizeProcessName(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const withUnixSeparators = trimmed.replace(/\\/g, '/');
  const base = withUnixSeparators.split('/').pop() ?? trimmed;
  return base.toLowerCase();
}

export function isActivePty(pty: PtyInfo): boolean {
  const processName = normalizeProcessName(pty.foregroundProcess);
  if (!processName) return false;
  const shellName = normalizeProcessName(pty.shell);
  if (!shellName) return true;
  return processName !== shellName;
}

export function filterActivePtys(ptys: PtyInfo[]): PtyInfo[] {
  return ptys.filter(isActivePty);
}

export function filterPtysByActivity(ptys: PtyInfo[], showInactive: boolean): PtyInfo[] {
  return showInactive ? ptys : filterActivePtys(ptys);
}

export function filterPtys(ptys: PtyInfo[], query: string): PtyInfo[] | FilterOperationError {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return ptys;

  const terms = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return ptys;

  // The filter callback is pure and safe, but we wrap with errore.try
  // at the boundary to enforce the error-as-values pattern consistently.
  const result = errore.try<PtyInfo[], FilterOperationError>({
    try: () =>
      ptys.filter((pty) => {
        const cwd = pty.cwd.toLowerCase();
        const branch = pty.gitBranch?.toLowerCase() ?? '';
        const process = pty.foregroundProcess?.toLowerCase() ?? '';
        return terms.some(
          (term) => cwd.includes(term) || branch.includes(term) || process.includes(term)
        );
      }),
    catch: (cause) =>
      new FilterOperationError({
        reason: `Failed to filter PTYs: ${String(cause)}`,
        cause,
      }),
  });

  if (result instanceof FilterOperationError) {
    console.warn('filterPtys failed:', result.message);
    return result;
  }
  return result;
}

export function buildPtyIndex(ptys: PtyInfo[]): Map<string, number> {
  return new Map(ptys.map((pty, index) => [pty.ptyId, index] as const));
}

export function groupPtysBySession(ptys: PtyInfo[]): Map<string, PtyInfo[]> {
  const groups = new Map<string, PtyInfo[]>();
  for (const pty of ptys) {
    const existing = groups.get(pty.sessionId);
    if (existing) {
      existing.push(pty);
      continue;
    }
    groups.set(pty.sessionId, [pty]);
  }
  return groups;
}

export function sortPtysForSession(
  ptys: PtyInfo[],
  paneOrder: Map<string, number> | undefined
): PtyInfo[] {
  return [...ptys].sort((a, b) => {
    const aOrder = a.paneId ? (paneOrder?.get(a.paneId) ?? a.sortOrderHint) : a.sortOrderHint;
    const bOrder = b.paneId ? (paneOrder?.get(b.paneId) ?? b.sortOrderHint) : b.sortOrderHint;

    const aHasOrder = aOrder !== undefined ? 1 : 0;
    const bHasOrder = bOrder !== undefined ? 1 : 0;
    if (aHasOrder !== bHasOrder) return bHasOrder - aHasOrder;
    if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    const workspaceCompare =
      (a.workspaceId ?? Number.MAX_SAFE_INTEGER) - (b.workspaceId ?? Number.MAX_SAFE_INTEGER);
    if (workspaceCompare !== 0) return workspaceCompare;

    return (a.paneId ?? a.ptyId).localeCompare(b.paneId ?? b.ptyId);
  });
}

export function extractSessionIds(ptys: PtyInfo[]): string[] {
  return [...new Set(ptys.map((pty) => pty.sessionId))];
}
