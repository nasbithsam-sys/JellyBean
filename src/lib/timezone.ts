// Project-wide timezone helpers. The CRM operates in PKT (Asia/Karachi).
// Days roll over at 11:59:59.999 PKT (i.e. 00:00 PKT).

export const PKT_TZ = "Asia/Karachi";

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
