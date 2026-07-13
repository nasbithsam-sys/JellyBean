// CS Pipeline timezone helpers.
//
// The CS Pipeline (and only the CS Pipeline) displays and filters dates in
// Eastern Time. Database timestamps remain stored in UTC — these helpers only
// convert between UTC (storage) and America/New_York (display / user input).
// DST is handled automatically because we always go through the IANA zone.

export const CS_PIPELINE_TIME_ZONE = "America/New_York";

type DateInput = Date | string | number | null | undefined;

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function etParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CS_PIPELINE_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Given a UTC instant, return the offset (in ms) such that
 * easternWallClockMs = utcMs + offset.
 */
function etOffsetMs(utcMs: number): number {
  const p = etParts(new Date(utcMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

/** Convert an Eastern wall-clock (y/m/d h:mi) into a real UTC Date. */
function etWallToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Two-pass refinement handles DST transitions correctly.
  let offset = etOffsetMs(naive);
  let utcMs = naive - offset;
  offset = etOffsetMs(utcMs);
  utcMs = naive - offset;
  return new Date(utcMs);
}

/** "YYYY-MM-DD" in Eastern Time for the given instant (defaults to now). */
export function csPipelineTodayKey(input: DateInput = new Date()): string {
  const d = toDate(input) ?? new Date();
  const p = etParts(d);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

/** UTC ISO for 00:00:00 Eastern Time on the ET calendar day of `input` (default now). */
export function csPipelineTodayStartUtcIso(input: DateInput = new Date()): string {
  const d = toDate(input) ?? new Date();
  const p = etParts(d);
  return etWallToUtc(p.year, p.month, p.day, 0, 0, 0, 0).toISOString();
}

/**
 * A local `Date` whose y/m/d match the current Eastern-Time calendar day.
 * Useful for seeding the ET-aware `<Calendar />` presets so that a user
 * in a different browser timezone still gets ET "today".
 */
export function csPipelineEtCalendarToday(): Date {
  const p = etParts(new Date());
  return new Date(p.year, p.month - 1, p.day);
}

/**
 * Build UTC ISO boundaries for an ET date range picked from a calendar
 * (the JS Date values only carry y/m/d in the local browser tz; we
 * reinterpret them as ET calendar dates).
 */
export function csPipelineDateRangeToUtcIso(
  from: Date | null | undefined,
  to: Date | null | undefined,
): { fromIso: string | null; toIso: string | null } {
  const fromIso = from
    ? etWallToUtc(from.getFullYear(), from.getMonth() + 1, from.getDate(), 0, 0, 0, 0).toISOString()
    : null;
  const end = to ?? from ?? null;
  const toIso = end
    ? etWallToUtc(
        end.getFullYear(),
        end.getMonth() + 1,
        end.getDate(),
        23,
        59,
        59,
        999,
      ).toISOString()
    : null;
  return { fromIso, toIso };
}

/** Full date+time formatted in Eastern Time, e.g. "Jul 13, 2026, 3:42 PM". */
export function formatCsPipelineDateTime(input: DateInput): string {
  const d = toDate(input);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CS_PIPELINE_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** Short date only, ET, e.g. "Jul 13". */
export function formatCsPipelineShortDate(input: DateInput): string {
  const d = toDate(input);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CS_PIPELINE_TIME_ZONE,
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Date with year, ET, e.g. "Jul 13, 2026". */
export function formatCsPipelineDateWithYear(input: DateInput): string {
  const d = toDate(input);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CS_PIPELINE_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/**
 * Convert a stored UTC ISO into a value suitable for
 * `<input type="datetime-local">`, expressed as ET wall clock:
 * "YYYY-MM-DDTHH:mm".
 */
export function utcIsoToCsPipelineInputValue(input: DateInput): string {
  const d = toDate(input);
  if (!d) return "";
  const p = etParts(d);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  const mi = String(p.minute).padStart(2, "0");
  return `${p.year}-${mm}-${dd}T${hh}:${mi}`;
}

/**
 * Convert an ET wall-clock value from `<input type="datetime-local">`
 * ("YYYY-MM-DDTHH:mm") into a UTC ISO string for storage.
 */
export function csPipelineInputValueToUtcIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return etWallToUtc(+y, +mo, +d, +h, +mi, s ? +s : 0, 0).toISOString();
}
