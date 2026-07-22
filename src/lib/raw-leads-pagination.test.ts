import { describe, expect, it } from "vitest";
import {
  getFirstCursor,
  getLastCursor,
  getLastPageSize,
  getTotalPages,
  resetRawLeadPageRequest,
  retainPreviousPageOnError,
  type RawLeadCursor,
} from "./raw-leads-pagination";

const rows: RawLeadCursor[] = [
  { captured_at: "2026-07-22T10:00:00.000Z", id: "99999999-0000-4000-8000-000000000003" },
  { captured_at: "2026-07-22T10:00:00.000Z", id: "99999999-0000-4000-8000-000000000002" },
  { captured_at: null, id: "99999999-0000-4000-8000-000000000001" },
];

describe("raw leads cursor pagination helpers", () => {
  it("uses the first displayed row for previous-page cursor boundaries", () => {
    expect(getFirstCursor(rows)).toEqual(rows[0]);
  });

  it("uses the last displayed row for next-page cursor boundaries", () => {
    expect(getLastCursor(rows)).toEqual(rows[2]);
  });

  it("keeps identical timestamps deterministic by retaining the unique row id", () => {
    expect(getFirstCursor(rows)?.captured_at).toBe(getLastCursor(rows.slice(0, 2))?.captured_at);
    expect(getFirstCursor(rows)?.id).not.toBe(getLastCursor(rows.slice(0, 2))?.id);
  });

  it("retains null timestamp cursors instead of dropping them", () => {
    expect(getLastCursor(rows)).toEqual({
      captured_at: null,
      id: "99999999-0000-4000-8000-000000000001",
    });
  });

  it("resets first-page navigation without a stale cursor", () => {
    expect(resetRawLeadPageRequest()).toEqual({
      direction: "first",
      cursor: null,
      targetPage: 1,
    });
  });

  it("computes partial final pages without filling from the prior page", () => {
    expect(getLastPageSize(163_777, 200)).toBe(177);
    expect(getLastPageSize(164_000, 200)).toBe(200);
  });

  it("does not collapse unknown counts into one total page", () => {
    expect(getTotalPages(undefined, 200)).toBeNull();
    expect(getTotalPages(null, 200)).toBeNull();
    expect(getTotalPages(0, 200)).toBe(1);
  });

  it("retains previous rows and page state when navigation fails", () => {
    const previous = { page: 819, rows, error: null };
    const error = new Error("canceling statement due to statement timeout");
    expect(retainPreviousPageOnError(previous, error)).toEqual({
      page: 819,
      rows,
      error,
    });
  });
});
