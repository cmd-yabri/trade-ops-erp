import { useEffect, useMemo, useState } from "react";

export const PAGE_SIZES = [10, 25, 50, 100];

export interface Pager<T> {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  pageItems: T[];
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

/**
 * Client-side pagination over an already filtered list.
 * `resetKey` (e.g. the search text + filters) sends the user back to page 1
 * whenever it changes, and the page is clamped when the list shrinks
 * (after a delete, for example).
 */
export function usePagination<T>(items: T[], initialSize = 10, resetKey: unknown = ""): Pager<T> {
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialSize);

  useEffect(() => setPageState(1), [resetKey]);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);

  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );

  return {
    page: current,
    pageSize,
    pageCount,
    total,
    from: total === 0 ? 0 : (current - 1) * pageSize + 1,
    to: Math.min(current * pageSize, total),
    pageItems,
    setPage: (p) => setPageState(Math.min(Math.max(1, p), pageCount)),
    setPageSize: (size) => {
      setPageSizeState(size);
      setPageState(1);
    },
  };
}
