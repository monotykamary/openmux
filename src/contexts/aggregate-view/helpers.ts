import type { PtyInfo } from './types';

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

export function filterPtys(ptys: PtyInfo[], query: string): PtyInfo[] {
  if (!query.trim()) return ptys;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return ptys;

  return ptys.filter((pty) => {
    const cwd = pty.cwd.toLowerCase();
    const branch = pty.gitBranch?.toLowerCase() ?? '';
    const process = pty.foregroundProcess?.toLowerCase() ?? '';
    return terms.some((term) =>
      cwd.includes(term) || branch.includes(term) || process.includes(term)
    );
  });
}

export function buildPtyIndex(ptys: PtyInfo[]): Map<string, number> {
  return new Map(ptys.map((p, i) => [p.ptyId, i]));
}
