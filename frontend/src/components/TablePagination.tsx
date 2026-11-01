import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAGE_SIZES, Pager } from "@/hooks/usePagination";

/** Page numbers to show: first, last, current +-1, with "..." gaps. */
function visiblePages(page: number, pageCount: number): (number | "gap")[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) result.push("gap");
    result.push(p);
  });
  return result;
}

interface TablePaginationProps<T> {
  pager: Pager<T>;
  className?: string;
}

export function TablePagination<T>({ pager, className }: TablePaginationProps<T>) {
  const { page, pageCount, pageSize, total, from, to, setPage, setPageSize } = pager;
  // Nothing to paginate: stay out of the way.
  if (total <= PAGE_SIZES[0]) return null;

  return (
    <div
      dir="rtl"
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 ${className ?? ""}`}
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          عرض {from}–{to} من {total}
        </span>
        <div className="flex items-center gap-2">
          <span>الصفوف:</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[76px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-1" aria-label="التنقل بين الصفحات">
        <Button variant="outline" size="icon" className="h-8 w-8" title="الأولى"
          disabled={page === 1} onClick={() => setPage(1)}>
          <ChevronsRight className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" title="السابقة"
          disabled={page === 1} onClick={() => setPage(page - 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        {visiblePages(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-muted-foreground">…</span>
          ) : (
            <Button key={p} size="icon" className="h-8 w-8 text-xs"
              variant={p === page ? "default" : "outline"}
              aria-current={p === page ? "page" : undefined}
              onClick={() => setPage(p)}>
              {p}
            </Button>
          ),
        )}
        <Button variant="outline" size="icon" className="h-8 w-8" title="التالية"
          disabled={page === pageCount} onClick={() => setPage(page + 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" title="الأخيرة"
          disabled={page === pageCount} onClick={() => setPage(pageCount)}>
          <ChevronsLeft className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
