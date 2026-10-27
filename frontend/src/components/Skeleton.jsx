import clsx from "clsx";

// Decorative: pages should expose loading via aria-busy on the container.
export function Skeleton({ className }) {
  return <div className={clsx("skeleton h-4 w-full", className)} aria-hidden="true" />;
}

// Varied widths so a table of identical bars doesn't look like a barcode.
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-1/3"];

/** Rows for use INSIDE <tbody> (renders <tr><td>…). */
export function TableSkeleton({ rows = 6, cols = 5 }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r} aria-hidden="true">
      {Array.from({ length: cols }, (_, c) => (
        <td key={c}>
          <Skeleton className={WIDTHS[(r + c) % WIDTHS.length]} />
        </td>
      ))}
    </tr>
  ));
}

export function CardSkeleton({ lines = 3, className }) {
  return (
    <div className={clsx("card p-4 sm:p-5", className)} aria-hidden="true">
      <Skeleton className="h-5 w-1/3" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={WIDTHS[i % WIDTHS.length]} />
        ))}
      </div>
    </div>
  );
}

export default Skeleton;
