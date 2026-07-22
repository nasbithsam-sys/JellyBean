export type RawLeadCursor = {
  captured_at: string | null;
  id: string;
};

export type RawLeadCursorDirection = "first" | "next" | "previous" | "last";

export type RawLeadPageRequest = {
  direction: RawLeadCursorDirection;
  cursor: RawLeadCursor | null;
  targetPage: number;
};

export type RawLeadPaginationState<T> = {
  page: number;
  rows: T[];
  error: Error | null;
};

export function getFirstCursor<T extends RawLeadCursor>(rows: T[]): RawLeadCursor | null {
  const row = rows[0];
  return row ? { captured_at: row.captured_at, id: row.id } : null;
}

export function getLastCursor<T extends RawLeadCursor>(rows: T[]): RawLeadCursor | null {
  const row = rows[rows.length - 1];
  return row ? { captured_at: row.captured_at, id: row.id } : null;
}

export function getLastPageSize(totalCount: number, pageSize: number): number {
  if (totalCount <= 0) return 0;
  const remainder = totalCount % pageSize;
  return remainder === 0 ? pageSize : remainder;
}

export function getTotalPages(totalCount: number | null | undefined, pageSize: number): number | null {
  if (typeof totalCount !== "number") return null;
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

export function resetRawLeadPageRequest(): RawLeadPageRequest {
  return { direction: "first", cursor: null, targetPage: 1 };
}

export function retainPreviousPageOnError<T>(
  previous: RawLeadPaginationState<T>,
  error: Error,
): RawLeadPaginationState<T> {
  return { ...previous, error };
}
