/** Convert a wall-clock choice to an instant, rejecting ambiguous DST choices. */
export function zonedDateTime(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Choose a valid date and time.");
  }
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const matches: string[] = [];
  // Every supported event zone has an offset in fifteen-minute increments.
  for (let offset = -12 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(wall - offset * 60_000);
    if (formatter.format(candidate).replace(" ", "T") === value) {
      matches.push(candidate.toISOString());
    }
  }
  if (!matches.length)
    throw new Error(
      "This local time does not exist because of a daylight saving change. Choose a different time.",
    );
  if (matches.length > 1)
    throw new Error(
      "This local time occurs twice because of a daylight saving change. Choose a time outside that hour.",
    );
  return matches[0];
}
