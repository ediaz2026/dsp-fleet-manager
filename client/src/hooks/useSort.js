import { useState, useMemo, useCallback } from 'react';

/**
 * useSort — generic client-side sort hook
 * @param {Array}  data        — the array to sort
 * @param {string} defaultKey  — initial sort column key (null = no sort)
 * @param {string} defaultDir  — 'asc' | 'desc'
 */
export function useSort(data, defaultKey = null, defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const sorted = useMemo(() => {
    if (!sortKey || !data?.length) return data ?? [];
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];

      // Handle nulls/undefineds — push to end
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      let cmp;
      // Date detection: ISO date strings like "2025-01-15" or "2025-01-15T..."
      if (typeof av === 'string' && /^\d{4}-\d{2}/.test(av)) {
        cmp = new Date(av) - new Date(bv);
      } else if (typeof av === 'number') {
        cmp = av - bv;
      } else if (typeof av === 'string' && !isNaN(Number(av)) && av.trim() !== '') {
        cmp = Number(av) - Number(bv);
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggle = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return key;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  const reset = useCallback(() => {
    setSortKey(defaultKey);
    setSortDir(defaultDir);
  }, [defaultKey, defaultDir]);

  return { sorted, sortKey, sortDir, toggle, reset };
}
