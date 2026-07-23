import { expect, test, describe } from "vitest";
import { buildRawLeadKeysetFilter } from "./raw-leads-keyset";

describe("buildRawLeadKeysetFilter", () => {
  test("generates correct filter for non-null captured_at", () => {
    const cursor = { captured_at: "2024-01-01T12:00:00Z", id: "uuid-123" };
    const filter = buildRawLeadKeysetFilter(cursor);
    expect(filter).toBe(
      "captured_at.lt.2024-01-01T12:00:00Z,and(captured_at.eq.2024-01-01T12:00:00Z,id.lt.uuid-123),captured_at.is.null"
    );
  });

  test("generates correct filter for null captured_at", () => {
    const cursor = { captured_at: null, id: "uuid-456" };
    const filter = buildRawLeadKeysetFilter(cursor);
    expect(filter).toBe("and(captured_at.is.null,id.lt.uuid-456)");
  });
});
