export type RawLeadCursor = {
  captured_at: string | null;
  id: string;
};

/**
 * Builds the PostgREST `.or()` filter string for keyset pagination on raw leads.
 * The sort order is: captured_at DESC NULLS LAST, id DESC.
 * This means to get the "next" page, we want rows that are "less than" the cursor.
 */
export function buildRawLeadKeysetFilter(cursor: RawLeadCursor): string {
  const idStr = cursor.id;
  
  if (cursor.captured_at) {
    const tsStr = cursor.captured_at;
    return `captured_at.lt.${tsStr},and(captured_at.eq.${tsStr},id.lt.${idStr}),captured_at.is.null`;
  } else {
    // If captured_at is already null, we can only paginate further by id.
    return `and(captured_at.is.null,id.lt.${idStr})`;
  }
}
