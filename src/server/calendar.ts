import type { ReddixEvent } from "@/lib/types";

export const escapeIcs = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
const stamp = (text: string) =>
  new Date(text)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

/** RFC 5545 folds by UTF-8 octets without splitting a multibyte character. */
export function foldCalendarLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const length = Buffer.byteLength(char, "utf8");
    if (bytes + length > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += length;
  }
  lines.push(current);
  return lines.join("\r\n");
}
export function eventCalendar(event: ReddixEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reddix//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@reddix`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SEQUENCE:${event.revision}`,
    `STATUS:${event.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.description + "\n\nDownloaded from Reddix. This calendar copy does not update automatically.")}`,
    `LOCATION:${escapeIcs(event.exactAddress ?? event.venue)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  return lines.map(foldCalendarLine).join("\r\n");
}
