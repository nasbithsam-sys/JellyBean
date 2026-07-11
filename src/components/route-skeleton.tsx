import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic pending fallback used by TanStack Router `pendingComponent` on
 * heavy routes. Keeps layout stable while the code-split chunk + loader
 * resolve so the user doesn't stare at a blank screen.
 */
export function RouteSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="p-6 space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
