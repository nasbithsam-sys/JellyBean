export type RawLeadCursor = {
  captured_at: string | null;
  id: string;
};

/**
 * Builds the PostgREST `.or()` filter string for keyset pagination on raw leads.
 * The sort order is: captured_at DESC NULLS LAST, id DESC.
 * This means to get the "next" page, we want rows that are "less than" the cursor.
 */
export function buildRawLeadKeysetFilter(
  cursor: RawLeadCursor,
  direction: "next" | "previous" = "next",
): string {
  // cursor.id is numeric
  const idStr = String(cursor.id);
  const ts = cursor.captured_at ? `"${cursor.captured_at}"` : null;

  if (direction === "next") {
    // Next fetches older records (captured_at DESC NULLS LAST, id DESC)
    if (ts) {
      // (captured_at < cursor.captured_at) OR (captured_at = cursor.captured_at AND id < cursor.id) OR (captured_at IS NULL)
      return `or(captured_at.lt.${ts},and(captured_at.eq.${ts},id.lt.${idStr}),captured_at.is.null)`;
    } else {
      // (captured_at IS NULL AND id < cursor.id)
      return `and(captured_at.is.null,id.lt.${idStr})`;
    }
  } else {
    // Previous fetches newer records (captured_at ASC NULLS FIRST, id ASC)
    if (ts) {
      // (captured_at > cursor.captured_at) OR (captured_at = cursor.captured_at AND id > cursor.id)
      return `or(captured_at.gt.${ts},and(captured_at.eq.${ts},id.gt.${idStr}))`;
    } else {
      // (captured_at IS NULL AND id > cursor.id) OR (captured_at IS NOT NULL)
      return `or(and(captured_at.is.null,id.gt.${idStr}),captured_at.not.is.null)`;
    }
  }
}

export function calculateTotalPages(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

export function calculateLastPageSize(totalCount: number, pageSize: number): number {
  if (totalCount === 0) return 0;
  return totalCount % pageSize || pageSize;
}
