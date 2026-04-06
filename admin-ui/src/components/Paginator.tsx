import { useState } from "react";

export function usePagination<T>(data: T[], pageSize: number = 10) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const slice = data.slice(start, start + pageSize);

  return {
    slice,
    page: currentPage,
    totalPages,
    total: data.length,
    from: data.length > 0 ? start + 1 : 0,
    to: start + slice.length,
    setPage,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
    prev: () => setPage((p) => Math.max(1, p - 1)),
    next: () => setPage((p) => Math.min(totalPages, p + 1)),
  };
}

interface PaginatorFooterProps {
  from: number;
  to: number;
  total: number;
  page: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  prev: () => void;
  next: () => void;
}

export function PaginatorFooter({
  from,
  to,
  total,
  page,
  totalPages,
  hasPrev,
  hasNext,
  prev,
  next,
}: PaginatorFooterProps) {
  if (total <= 10) return null;

  const btnCls = (enabled: boolean) =>
    `px-2.5 py-1 rounded text-xs border transition-colors ${
      enabled
        ? "text-slate-300 border-slate-700 hover:bg-slate-700 hover:border-slate-600"
        : "text-slate-600 border-slate-800 cursor-not-allowed"
    }`;

  return (
    <div className="px-5 py-3 flex items-center justify-between border-t border-slate-700/60">
      <span className="text-xs text-slate-500">
        Showing {from}&ndash;{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button onClick={prev} disabled={!hasPrev} className={btnCls(hasPrev)}>
          &larr; Prev
        </button>
        <span className="text-xs text-slate-500 tabular-nums">
          {page} / {totalPages}
        </span>
        <button onClick={next} disabled={!hasNext} className={btnCls(hasNext)}>
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
