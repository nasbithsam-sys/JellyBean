// Project-wide timezone helpers. The CRM operates in PKT (Asia/Karachi).
// Days roll over at 11:59:59.999 PKT (i.e. 00:00 PKT).

export const PKT_TZ = "Asia/Karachi";

export function pktParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PKT_TZ,
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

/** Returns a stable day key (YYYY-MM-DD) for the given date in PKT. */
export function pktDayKey(input: Date | string | null | undefined): string {
  if (!input) return "";
  const date = typeof input === "string" ? new Date(input) : input;
  // en-CA produces YYYY-MM-DD format directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PKT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Today's PKT day key, computed against the current instant. */
export function pktTodayKey(): string {
  return pktDayKey(new Date());
}

/** Locale-formatted date/time string in PKT. */
export function formatPKT(
  input: Date | string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  if (!input) return "";
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en-US", { timeZone: PKT_TZ, ...opts }).format(date);
}

/**
 * Given any UTC Date, returns a local Date where the local year/month/day/hour/etc
 * exactly match the PKT wall-clock year/month/day/hour/etc for that UTC instant.
 * This allows passing the result to date-fns or UI components that blindly use
 * local time, effectively forcing them to operate on PKT boundaries.
 */
export function toPktWallClockDate(input: Date | string | number): Date {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return d;
  const p = pktParts(d);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
