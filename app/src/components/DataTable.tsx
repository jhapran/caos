import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** raw sortable value */
  sortValue?: (row: T) => string | number;
  numeric?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  emptyMessage?: string;
  className?: string;
  caption?: string;
}

/** DataTable — sticky header, caption column headers, zebra rows, sorting, pagination footer. */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  pageSize = 15,
  emptyMessage = 'Nothing to show',
  className,
  caption,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  };

  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-card shadow-card', className)}>
      {caption && <div className="border-b border-line px-5 py-3 text-[13px] font-medium text-ink-2">{caption}</div>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] leading-5">
          <thead className="sticky top-0 z-10">
            <tr className="bg-paper-deep/70">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'border-b border-line px-4 py-2.5 text-caption whitespace-nowrap',
                    c.numeric ? 'text-right' : 'text-left',
                    c.className,
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn('inline-flex items-center gap-1 uppercase tracking-[0.06em]', c.numeric && 'flex-row-reverse')}
                    >
                      {c.header}
                      {sortKey === c.key ? (
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', sortDir === 'asc' && 'rotate-180')} />
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line/60 transition-colors',
                  i % 2 === 1 && 'bg-paper-deep/50',
                  onRowClick && 'cursor-pointer hover:bg-brand-soft/40',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('px-4 py-3 align-middle', c.numeric && 'text-right tnum', c.className)}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-ink-3">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[12px] text-ink-3">
        <span className="tnum">
          Showing {sorted.length === 0 ? 0 : clampedPage * pageSize + 1}–{Math.min((clampedPage + 1) * pageSize, sorted.length)} of {sorted.length}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md p-1.5 text-ink-2 transition-colors hover:bg-paper-deep disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={clampedPage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="rounded-md p-1.5 text-ink-2 transition-colors hover:bg-paper-deep disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Link-styled button for "n clients" cells that open drill-downs. */
export function DrillLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="font-medium text-brand underline decoration-brand/40 underline-offset-2 transition-colors hover:text-brand-deep hover:decoration-gold tnum"
    >
      {children}
    </button>
  );
}
