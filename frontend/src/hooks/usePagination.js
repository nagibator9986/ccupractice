import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Client-side pagination. `page` is 1-based.
 * `resetKey` (optional): when it changes (e.g. search text + filters) the page
 * jumps back to 1 — otherwise a new filter leaves the user stranded on page 3.
 */
export default function usePagination(items, initialPageSize = 50, resetKey) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [rawPage, setRawPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Derived clamp: a delete/filter that shrinks the list must never leave us
  // rendering an empty page beyond the end, even for one frame.
  const page = Math.min(Math.max(1, rawPage), totalPages);

  useEffect(() => {
    if (rawPage !== page) setRawPage(page);
  }, [rawPage, page]);

  const keyRef = useRef(resetKey);
  useEffect(() => {
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey;
      setRawPage(1);
    }
  }, [resetKey]);

  const setPage = useCallback((p) => {
    setRawPage((cur) => {
      const next = typeof p === "function" ? p(cur) : p;
      const n = Number.isFinite(Number(next)) ? Math.floor(Number(next)) : 1;
      return Math.max(1, n);
    });
  }, []);

  const setPageSize = useCallback((size) => {
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) return;
    setPageSizeState(n);
    setRawPage(1);
  }, []);

  const pageItems = useMemo(
    () => list.slice((page - 1) * pageSize, page * pageSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, page, pageSize],
  );

  return { page, setPage, pageSize, setPageSize, totalPages, pageItems, total };
}
