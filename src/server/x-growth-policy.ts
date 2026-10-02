/** Conservative rendering prevents user titles from adding mentions or external links. */
export function publicTitle(title: string, budget = 140) {
  const safe = title
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/www\.\S+/gi, "[link]")
    .replace(/@/g, "＠")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let output = "",
    weight = 0;
  for (const character of safe) {
    const cost = character.codePointAt(0)! > 0x10ff ? 2 : 1;
    if (weight + cost > budget - 3) return output + "...";
    output += character;
    weight += cost;
  }
  return output;
}
export function safeHandle(value: string) {
  return /^[a-zA-Z0-9_]{1,15}$/.test(value) ? `@${value}` : "a Reddix member";
}
/** Commands must be directed only to our bot. Retweets and conversational mentions do not opt in. */
export function inviteCommand(
  text: string,
  botHandle: string,
): "invite" | "stop" | null {
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(botHandle)) return null;
  const normalized = text.trim();
  if (new RegExp(`^@${botHandle}\\s+stop[.!]?\\s*$`, "i").test(normalized))
    return "stop";
  return new RegExp(
    `^@${botHandle}\\s+(?:please\\s+)?(?:dm me (?:an? )?invite(?: code)?|invite me via dm)[.!]?\\s*$`,
    "i",
  ).test(normalized)
    ? "invite"
    : null;
}
export function previousLocalDay(
  now = new Date(),
  timeZone = "America/Los_Angeles",
) {
  // Calendar arithmetic is deliberately separate from elapsed-day arithmetic (DST).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = new Date(
    `${part("year")}-${part("month")}-${part("day")}T12:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
