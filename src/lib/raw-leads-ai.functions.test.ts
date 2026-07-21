import { describe, it, expect } from "vitest";
import { parseAndValidateAiResults } from "./raw-leads-ai.functions";

const json = (obj: unknown) => JSON.stringify(obj);

describe("parseAndValidateAiResults", () => {
  it("maps a complete valid response to the correct row keys", () => {
    const keys = ["rk-a", "rk-b", "rk-c"];
    const text = json({
      results: [
        { id: "1", lead: "yes" },
        { id: "2", lead: "no" },
        { id: "3", lead: "yes" },
      ],
    });
    expect(parseAndValidateAiResults(text, keys)).toEqual([
      { row_key: "rk-a", lead: "yes" },
      { row_key: "rk-b", lead: "no" },
      { row_key: "rk-c", lead: "yes" },
    ]);
  });

  it("maps ids to the correct row keys when results are out of order", () => {
    const keys = ["rk-a", "rk-b", "rk-c"];
    const text = json({
      results: [
        { id: "3", lead: "yes" },
        { id: "1", lead: "no" },
        { id: "2", lead: "yes" },
      ],
    });
    const out = parseAndValidateAiResults(text, keys);
    const byKey = Object.fromEntries(out.map((r) => [r.row_key, r.lead]));
    expect(byKey).toEqual({ "rk-a": "no", "rk-b": "yes", "rk-c": "yes" });
  });

  it("throws when an expected id is missing", () => {
    const keys = ["rk-a", "rk-b", "rk-c"];
    const text = json({
      results: [
        { id: "1", lead: "yes" },
        { id: "2", lead: "no" },
      ],
    });
    expect(() => parseAndValidateAiResults(text, keys)).toThrow(/incomplete|missing/i);
  });

  it("throws when the same id appears twice", () => {
    const keys = ["rk-a", "rk-b"];
    const text = json({
      results: [
        { id: "1", lead: "yes" },
        { id: "1", lead: "no" },
      ],
    });
    expect(() => parseAndValidateAiResults(text, keys)).toThrow(/duplicate/i);
  });

  it("throws when the response contains an unknown id", () => {
    const keys = ["rk-a", "rk-b"];
    const text = json({
      results: [
        { id: "1", lead: "yes" },
        { id: "99", lead: "no" },
      ],
    });
    expect(() => parseAndValidateAiResults(text, keys)).toThrow(/unexpected|missing id/i);
  });

  it("throws when a decision is not lowercase yes or no", () => {
    const keys = ["rk-a"];
    const text = json({ results: [{ id: "1", lead: "YES" }] });
    expect(() => parseAndValidateAiResults(text, keys)).toThrow(/invalid decision/i);

    const text2 = json({ results: [{ id: "1", lead: "maybe" }] });
    expect(() => parseAndValidateAiResults(text2, keys)).toThrow(/invalid decision/i);
  });

  it("throws a clear parsing error on invalid JSON", () => {
    expect(() => parseAndValidateAiResults("not json {", ["rk-a"])).toThrow(/not valid JSON/i);
  });

  it("throws when results is empty but keys are non-empty", () => {
    const keys = ["rk-a", "rk-b"];
    const text = json({ results: [] });
    expect(() => parseAndValidateAiResults(text, keys)).toThrow(/incomplete|missing/i);
  });

  it("maps all ten items to the correct row keys", () => {
    const keys = Array.from({ length: 10 }, (_, i) => `key-${i + 1}`);
    const decisions: Array<"yes" | "no"> = [
      "yes",
      "no",
      "yes",
      "no",
      "yes",
      "no",
      "yes",
      "no",
      "yes",
      "no",
    ];
    const text = json({
      results: decisions.map((lead, i) => ({ id: String(i + 1), lead })),
    });
    const out = parseAndValidateAiResults(text, keys);
    expect(out).toHaveLength(10);
    out.forEach((row, i) => {
      expect(row.row_key).toBe(keys[i]);
      expect(row.lead).toBe(decisions[i]);
    });
  });

  it("throws when an extra unexpected result is included", () => {
    const keys = ["rk-a", "rk-b"];
    const text = json({
      results: [
        { id: "1", lead: "yes" },
        { id: "2", lead: "no" },
        { id: "3", lead: "yes" },
      ],
    });
    expect(() => parseAndValidateAiResults(text, keys)).toThrow(/unexpected|missing id/i);
  });
});
