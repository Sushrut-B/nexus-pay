/** Release 15 — timezone-aware itinerary rendering using the provider's local zone. */

export function formatLocalDateTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone,
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: true,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone });
    return true;
  } catch {
    return false;
  }
}
