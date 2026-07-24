import { describe, expect, test } from "vitest";
import {
  csPipelineDateKeyRangeToUtcIso,
  csPipelineDateRangeToUtcIso,
  csPipelineNextEasternMidnight,
  csPipelineRelativeDateRangeKeys,
  csPipelineTodayKey,
  formatCsPipelineCalendarDateWithYear,
} from "./cs-pipeline-time";

describe("CS Pipeline Eastern date key", () => {
  test("rolls over at Eastern midnight during summer", () => {
    expect(csPipelineTodayKey("2026-07-24T03:59:59.999Z")).toBe("2026-07-23");
    expect(csPipelineTodayKey("2026-07-24T04:00:00.000Z")).toBe("2026-07-24");
  });

  test("Pakistan midnight does not advance the Eastern date or Today range", () => {
    const beforePakistanMidnight = "2026-07-23T18:59:59.999Z";
    const pakistanMidnight = "2026-07-23T19:00:00.000Z";

    expect(csPipelineTodayKey(beforePakistanMidnight)).toBe("2026-07-23");
    expect(csPipelineTodayKey(pakistanMidnight)).toBe("2026-07-23");
    expect(
      csPipelineRelativeDateRangeKeys("today", csPipelineTodayKey(beforePakistanMidnight)),
    ).toEqual(csPipelineRelativeDateRangeKeys("today", csPipelineTodayKey(pakistanMidnight)));
  });

  test("rolls over at Eastern midnight during winter", () => {
    expect(csPipelineTodayKey("2026-12-01T04:59:59.999Z")).toBe("2026-11-30");
    expect(csPipelineTodayKey("2026-12-01T05:00:00.000Z")).toBe("2026-12-01");
  });
});

describe("CS Pipeline UTC query boundaries", () => {
  test("builds half-open summer Today boundaries", () => {
    expect(csPipelineDateKeyRangeToUtcIso("2026-07-24", "2026-07-24")).toEqual({
      fromIso: "2026-07-24T04:00:00.000Z",
      toIso: "2026-07-25T04:00:00.000Z",
    });
  });

  test("uses 23-hour and 25-hour Eastern days around DST", () => {
    const spring = csPipelineDateKeyRangeToUtcIso("2026-03-08", "2026-03-08");
    const fall = csPipelineDateKeyRangeToUtcIso("2026-11-01", "2026-11-01");

    expect(Date.parse(fall.toIso!) - Date.parse(fall.fromIso!)).toBe(25 * 60 * 60 * 1000);
    expect(Date.parse(spring.toIso!) - Date.parse(spring.fromIso!)).toBe(23 * 60 * 60 * 1000);
  });
});

describe("CS Pipeline relative presets", () => {
  test("slide forward when the Eastern date changes", () => {
    const before = "2026-07-23";
    const after = "2026-07-24";

    expect(csPipelineRelativeDateRangeKeys("today", before)).toEqual({
      fromKey: "2026-07-23",
      toKey: "2026-07-23",
    });
    expect(csPipelineRelativeDateRangeKeys("today", after)).toEqual({
      fromKey: "2026-07-24",
      toKey: "2026-07-24",
    });
    expect(csPipelineRelativeDateRangeKeys("yesterday", after)).toEqual({
      fromKey: "2026-07-23",
      toKey: "2026-07-23",
    });
    expect(csPipelineRelativeDateRangeKeys("last7", after)).toEqual({
      fromKey: "2026-07-18",
      toKey: "2026-07-24",
    });
    expect(csPipelineRelativeDateRangeKeys("last30", after)).toEqual({
      fromKey: "2026-06-25",
      toKey: "2026-07-24",
    });
    expect(csPipelineRelativeDateRangeKeys("last90", after)).toEqual({
      fromKey: "2026-04-26",
      toKey: "2026-07-24",
    });
  });

  test("custom date ranges remain fixed across Eastern date changes", () => {
    const custom = { fromKey: "2026-07-10", toKey: "2026-07-12" };
    expect(custom).toEqual({ fromKey: "2026-07-10", toKey: "2026-07-12" });
  });
});

describe("CS Pipeline calendar date handling", () => {
  test("Pakistan-local July 24 calendar selection remains July 24", () => {
    const selected = new Date(2026, 6, 24);
    expect(formatCsPipelineCalendarDateWithYear(selected)).toBe("Jul 24, 2026");
    expect(csPipelineDateRangeToUtcIso(selected, selected)).toEqual({
      fromIso: "2026-07-24T04:00:00.000Z",
      toIso: "2026-07-25T04:00:00.000Z",
    });
  });
});

describe("CS Pipeline Eastern midnight scheduler", () => {
  test("targets the next New York midnight, not Pakistan midnight", () => {
    expect(csPipelineNextEasternMidnight("2026-07-23T19:00:00.000Z").toISOString()).toBe(
      "2026-07-24T04:00:00.000Z",
    );
    expect(csPipelineNextEasternMidnight("2026-12-01T04:59:59.999Z").toISOString()).toBe(
      "2026-12-01T05:00:00.000Z",
    );
  });
});
