/** Upgrade X thumbnails without changing unrelated images or original uploads. */
export function highResolutionAvatar(value: string | null): string | null {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (
      url.hostname !== "pbs.twimg.com" ||
      !["https:", "http:"].includes(url.protocol) ||
      !url.pathname.startsWith("/profile_images/")
    )
      return value;
    const pathname = url.pathname.replace(
      /_(?:normal|bigger|mini)(?=\.[^/.]+$)/,
      "_400x400",
    );
    if (pathname === url.pathname) return value;
    url.pathname = pathname;
    return url.href;
  } catch {
    return value;
  }
}
