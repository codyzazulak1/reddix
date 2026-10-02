import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Parser } from "htmlparser2";
import ipaddr from "ipaddr.js";
import sharp from "sharp";

const LOOKUP_TIMEOUT_MS = 7_000;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_CANDIDATES = 3;
const MAX_INPUT_PIXELS = 20_000_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

type Preview = { data: Buffer; width: number; height: number };
type Download = {
  body: Buffer;
  headers: IncomingHttpHeaders;
  status: number;
};

function publicAddress(address: string): boolean {
  // Azure's platform virtual IP is globally numbered but serves host services.
  if (!isIP(address) || address === "168.63.129.16") return false;
  const parsed = ipaddr.parse(address);
  // Reject transition mechanisms as well as private and reserved ranges. IPv6
  // is limited to global unicast so unallocated ranges cannot become a bypass.
  return (
    parsed.range() === "unicast" &&
    (parsed.kind() === "ipv4" ||
      (parsed as ipaddr.IPv6).match(ipaddr.IPv6.parse("2000::"), 3))
  );
}

function publicUrl(value: string, base?: URL): URL {
  if (value.length > 8_192) throw new Error("Preview URL is too long");
  const url = new URL(value, base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Unsupported preview URL");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    !hostname ||
    (isIP(hostname)
      ? !publicAddress(hostname)
      : !hostname.includes(".") ||
        /(?:^|\.)(?:localhost|local|internal|home|lan|onion|invalid|test)$/.test(
          hostname,
        ))
  )
    throw new Error("Preview destination is not public");
  url.hash = "";
  return url;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
    if (signal.aborted) onAbort();
  });
}

async function pinnedLookup(
  url: URL,
  signal: AbortSignal,
): Promise<LookupFunction> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await abortable(lookup(hostname, { all: true, verbatim: true }), signal);
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicAddress(address))
  )
    throw new Error("Preview DNS destination is not public");

  // The socket uses exactly the validated answer. A second system DNS lookup
  // here would allow a hostname to rebind to an internal service after checking.
  const address = addresses[0];
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}

async function download(
  url: URL,
  kind: "html" | "image",
  signal: AbortSignal,
): Promise<Download> {
  const pinned = await pinnedLookup(url, signal);
  signal.throwIfAborted();
  const maxBytes = kind === "html" ? MAX_HTML_BYTES : MAX_IMAGE_BYTES;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        agent: false,
        lookup: pinned,
        signal,
        maxHeaderSize: 16 * 1024,
        headers: {
          "User-Agent": "Reddix-LinkPreview/1.0",
          Accept:
            kind === "html"
              ? "text/html, application/xhtml+xml"
              : "image/avif, image/webp, image/png, image/jpeg, image/gif",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers = response.headers;
        response.on("error", reject);
        if (redirectStatuses.has(status)) {
          resolve({ status, headers, body: Buffer.alloc(0) });
          response.destroy();
          return;
        }
        const contentType = headers["content-type"]
          ?.split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (
          status !== 200 ||
          Number(headers["content-length"]) > maxBytes ||
          (headers["content-encoding"] &&
            headers["content-encoding"] !== "identity") ||
          (kind === "html" &&
            contentType !== "text/html" &&
            contentType !== "application/xhtml+xml") ||
          contentType === "image/svg+xml"
        ) {
          reject(new Error("Unsupported preview response"));
          response.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > maxBytes) {
            reject(new Error("Preview response is too large"));
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({ status, headers, body: Buffer.concat(chunks, length) });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function followRedirects(
  input: URL,
  kind: "html" | "image",
  signal: AbortSignal,
): Promise<{ body: Buffer; url: URL }> {
  let url = input;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await download(url, kind, signal);
    if (!redirectStatuses.has(response.status))
      return { body: response.body, url };
    if (!response.headers.location || redirects === MAX_REDIRECTS)
      throw new Error("Too many preview redirects");
    // Validate both page and image redirects, including fresh DNS answers when
    // a redirect uses the same hostname as the previous request.
    url = publicUrl(response.headers.location, url);
  }
  throw new Error("Preview redirect failed");
}

function imageCandidates(html: Buffer, pageUrl: URL): URL[] {
  const images: { url?: string; secure?: string }[] = [];
  let currentImage: (typeof images)[number] | undefined;
  let baseHref: string | undefined;
  let ignoredDepth = 0;
  const ignoredTags = new Set([
    "script",
    "style",
    "template",
    "noscript",
    "svg",
    "math",
  ]);
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (ignoredDepth || ignoredTags.has(name)) {
          ignoredDepth++;
          return;
        }
        if (name === "base" && baseHref === undefined && attributes.href)
          baseHref = attributes.href;
        if (name !== "meta") return;
        const property = (attributes.property ?? attributes.name)
          ?.trim()
          .toLowerCase();
        const content = attributes.content?.trim();
        if (!content) return;
        if (property === "og:image" || property === "og:image:url") {
          currentImage = { url: content };
          if (images.length < MAX_IMAGE_CANDIDATES) images.push(currentImage);
        } else if (property === "og:image:secure_url") {
          if (!currentImage) {
            currentImage = {};
            images.push(currentImage);
          }
          currentImage.secure ??= content;
        }
      },
      onclosetag() {
        if (ignoredDepth) ignoredDepth--;
      },
    },
    { decodeEntities: true },
  );
  parser.end(html.toString("utf8"));
  let base = pageUrl;
  if (baseHref) {
    try {
      base = publicUrl(baseHref, pageUrl);
    } catch {
      // Ignore an unusable base URL; a valid absolute image can still work.
    }
  }
  const candidates = new Map<string, URL>();
  for (const image of images) {
    for (const value of [image.secure, image.url]) {
      if (!value) continue;
      try {
        const url = publicUrl(value, base);
        if (value === image.secure && url.protocol !== "https:") continue;
        candidates.set(url.href, url);
      } catch {
        // Some pages publish a broken candidate alongside a usable image.
      }
    }
  }
  return [...candidates.values()].slice(0, MAX_IMAGE_CANDIDATES);
}

function hasRasterSignature(data: Buffer): boolean {
  return (
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
    ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6)) ||
    (data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP") ||
    (data.toString("ascii", 4, 8) === "ftyp" &&
      ["avif", "avis"].includes(data.toString("ascii", 8, 12)))
  );
}

async function normalizeImage(
  body: Buffer,
  deadline: number,
  signal: AbortSignal,
): Promise<Preview> {
  // Check magic bytes before invoking a decoder, so SVG/PDF inputs cannot be
  // interpreted even when the remote Content-Type claims to be a raster image.
  if (!hasRasterSignature(body)) throw new Error("Unsupported preview image");
  signal.throwIfAborted();
  const pipeline = sharp(body, {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "error",
    animated: false,
  }).timeout({
    seconds: Math.max(1, Math.ceil((deadline - Date.now()) / 1_000)),
  });
  const stop = () => pipeline.destroy();
  signal.addEventListener("abort", stop, { once: true });
  try {
    const metadata = await abortable(pipeline.metadata(), signal);
    if (
      !metadata.format ||
      !["jpeg", "png", "webp", "gif", "heif"].includes(metadata.format) ||
      !metadata.width ||
      !metadata.height
    )
      throw new Error("Unsupported preview image");
    const { data, info } = await abortable(
      pipeline
        .rotate()
        .resize({
          width: 1_200,
          height: 1_200,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true }),
      signal,
    );
    return { data, width: info.width, height: info.height };
  } finally {
    signal.removeEventListener("abort", stop);
    pipeline.destroy();
  }
}

/** Optional enrichment only: unavailable, unsafe, or slow previews are misses. */
export async function fetchOpenGraphPreview(
  url: string,
): Promise<Preview | null> {
  const controller = new AbortController();
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  const signal = controller.signal;
  try {
    const page = await abortable(
      followRedirects(publicUrl(url), "html", signal),
      signal,
    );
    for (const candidate of imageCandidates(page.body, page.url)) {
      try {
        const image = await abortable(
          followRedirects(candidate, "image", signal),
          signal,
        );
        return await normalizeImage(image.body, deadline, signal);
      } catch {
        if (signal.aborted) return null;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
