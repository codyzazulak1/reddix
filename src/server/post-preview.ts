import { randomUUID } from "node:crypto";
import { fetchOpenGraphPreview } from "./link-preview";
import { writePrivateImage } from "./storage";

export type PreparedPostPreview = {
  id: string;
  storageKey: string;
  byteSize: number;
  width: number;
  height: number;
};

/** Prefer the submitted link; otherwise use the first URL in the discussion. */
export function postPreviewUrl(
  url: string | null,
  body: string,
): string | null {
  if (url) return url;
  const candidate = body.match(/https?:\/\/[^\s<>"'`]+/i)?.[0];
  if (!candidate) return null;
  let link = candidate.replace(/[.,!?;:]+$/, "");
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]) {
    while (
      link.endsWith(close) &&
      link.split(close).length > link.split(open).length
    )
      link = link.slice(0, -1);
  }
  try {
    const parsed = new URL(link);
    return parsed.username || parsed.password ? null : parsed.href;
  } catch {
    return null;
  }
}

/** Stage a private image; the post transaction attaches its media record. */
export async function preparePostPreview(
  url: string | null,
  body: string,
): Promise<PreparedPostPreview | null> {
  const target = postPreviewUrl(url, body);
  if (!target) return null;
  try {
    const image = await fetchOpenGraphPreview(target);
    if (!image) return null;
    const id = randomUUID();
    const storageKey = await writePrivateImage(
      id,
      image.data,
      "image/webp",
      AbortSignal.timeout(4_000),
    );
    return {
      id,
      storageKey,
      byteSize: image.data.length,
      width: image.width,
      height: image.height,
    };
  } catch {
    // A site's metadata or image storage must never prevent publication.
    return null;
  }
}
