import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DomainError } from "./domain";

const localDirectory = () => path.join(process.cwd(), ".data", "media");
const validImageId = /^[a-f0-9-]{36}$/;
const validSupabaseKey = /^supabase:media\/[a-f0-9-]{36}\.webp$/;
let cachedClient: S3Client | undefined;

function storageUnavailable(): DomainError {
  return new DomainError(
    "STORAGE_UNAVAILABLE",
    "Private image storage is temporarily unavailable. Please try again.",
    503,
  );
}

function supabaseConfig() {
  const secret = process.env.SUPABASE_SECRET_KEY,
    bucket = process.env.STORAGE_BUCKET;
  let url: URL;
  try {
    url = new URL(process.env.SUPABASE_URL ?? "");
  } catch {
    throw new DomainError(
      "STORAGE_NOT_CONFIGURED",
      "The Supabase project URL is not configured correctly.",
      503,
    );
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol !== "https:" &&
      (process.env.NODE_ENV === "production" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !bucket ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(bucket) ||
    !secret?.startsWith("sb_secret_") ||
    /\s/.test(secret)
  )
    throw new DomainError(
      "STORAGE_NOT_CONFIGURED",
      "Private Supabase storage is not configured correctly.",
      503,
    );
  return { origin: url.origin, bucket, secret };
}

/** Supabase API keys are not JWTs. They belong only in the apikey header. */
async function supabaseRequest(
  route: string,
  init: RequestInit = {},
): Promise<Response> {
  init.signal?.throwIfAborted();
  const { origin, secret } = supabaseConfig();
  try {
    return await fetch(`${origin}/storage/v1/${route}`, {
      ...init,
      headers: { ...init.headers, apikey: secret },
      cache: "no-store",
      redirect: "error",
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
  } catch {
    init.signal?.throwIfAborted();
    // Never expose provider errors, URLs, credentials, or response bodies.
    throw storageUnavailable();
  }
}

async function smallJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 16_384) return null;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function requireSupabaseResponse(
  response: Response,
  allowMissing = false,
): Promise<boolean> {
  if (response.ok) return true;
  const detail = await smallJson(response);
  const missing =
    response.status === 404 ||
    (response.status === 400 &&
      detail !== null &&
      typeof detail === "object" &&
      (("code" in detail && detail.code === "NoSuchKey") ||
        ("statusCode" in detail && String(detail.statusCode) === "404")));
  if (missing && allowMissing) return false;
  throw storageUnavailable();
}

async function assertPrivateSupabaseBucket(
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const { bucket } = supabaseConfig();
  const response = await supabaseRequest(`bucket/${bucket}`, { signal });
  await requireSupabaseResponse(response);
  const detail = await smallJson(response);
  signal?.throwIfAborted();
  if (
    !detail ||
    typeof detail !== "object" ||
    !("public" in detail) ||
    detail.public !== false ||
    !("id" in detail) ||
    detail.id !== bucket
  )
    throw new DomainError(
      "STORAGE_NOT_CONFIGURED",
      "Image uploads require a private Supabase bucket.",
      503,
    );
}

function supabaseKey(key: string): string {
  if (!validSupabaseKey.test(key))
    throw new DomainError(
      "RESOURCE_NOT_FOUND",
      "This image is unavailable.",
      404,
    );
  return key.slice("supabase:".length);
}

function storageClient(): S3Client {
  if (cachedClient) return cachedClient;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!process.env.STORAGE_BUCKET || !accessKeyId || !secretAccessKey)
    throw new DomainError(
      "STORAGE_NOT_CONFIGURED",
      "Private image storage is not configured yet.",
      503,
    );
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (endpoint) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new DomainError(
        "STORAGE_NOT_CONFIGURED",
        "The private storage endpoint is not configured correctly.",
        503,
      );
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
      throw new DomainError(
        "STORAGE_NOT_CONFIGURED",
        "Production storage requires an HTTPS endpoint.",
        503,
      );
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new DomainError(
        "STORAGE_NOT_CONFIGURED",
        "The private storage endpoint is not configured correctly.",
        503,
      );
  }
  cachedClient = new S3Client({
    region: process.env.STORAGE_REGION ?? "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    maxAttempts: 3,
  });
  return cachedClient;
}

async function cleanUpInterruptedWrite(key: string): Promise<void> {
  try {
    await deletePrivateImage(key, AbortSignal.timeout(2_000));
  } catch {
    // Cancellation can race a remote commit. Cleanup is best effort, and these
    // fresh objects remain private and unattached if the provider is unavailable.
    console.error("Could not clean up an interrupted private image write", {
      storageKey: key,
    });
  }
}

/**
 * All keys are private. A caller supplying a signal must use a fresh,
 * unreferenced ID: interrupted writes get a bounded best-effort cleanup.
 */
export async function writePrivateImage(
  id: string,
  data: Buffer,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!validImageId.test(id))
    throw new Error("Invalid private image identifier.");
  const provider =
    process.env.STORAGE_PROVIDER ||
    (process.env.STORAGE_BUCKET ? "s3" : "local");
  if (provider === "supabase") {
    const { bucket } = supabaseConfig();
    await assertPrivateSupabaseBucket(signal);
    signal?.throwIfAborted();
    const objectKey = `media/${id}.webp`;
    const key = `supabase:${objectKey}`;
    let response: Response | undefined;
    try {
      response = await supabaseRequest(`object/${bucket}/${objectKey}`, {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "private, no-store",
          "x-upsert": "false",
        },
        body: new Uint8Array(data),
        signal,
      });
      await requireSupabaseResponse(response);
      await response.body?.cancel().catch(() => {});
      signal?.throwIfAborted();
      return key;
    } catch (error) {
      // An explicit rejected upload did not create an object. In particular,
      // never delete an existing object after a non-upserting conflict.
      if (signal && (!response || response.ok))
        await cleanUpInterruptedWrite(key);
      throw error;
    }
  }
  if (!["s3", "local"].includes(provider))
    throw new DomainError(
      "STORAGE_NOT_CONFIGURED",
      "The private storage provider is not configured correctly.",
      503,
    );
  if (provider === "s3") {
    const objectKey = `media/${id}.webp`;
    const key = `s3:${objectKey}`;
    const client = storageClient();
    signal?.throwIfAborted();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.STORAGE_BUCKET,
          Key: objectKey,
          Body: data,
          ContentType: mimeType,
          CacheControl: "private, no-store",
          ContentLength: data.length,
          ...(signal ? { IfNoneMatch: "*" } : {}),
        }),
        { abortSignal: signal },
      );
      signal?.throwIfAborted();
      return key;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      const rejected = status !== undefined && status >= 400 && status < 500;
      if (signal && !rejected) await cleanUpInterruptedWrite(key);
      throw error;
    }
  }
  if (process.env.NODE_ENV === "production")
    throw new DomainError(
      "STORAGE_NOT_CONFIGURED",
      "Connect private image storage to enable uploads.",
      503,
    );
  const key = `${id}.webp`;
  await mkdir(localDirectory(), { recursive: true });
  signal?.throwIfAborted();
  try {
    await writeFile(path.join(localDirectory(), key), data, {
      flag: "wx",
      mode: 0o600,
      signal,
    });
    signal?.throwIfAborted();
    return key;
  } catch (error) {
    if (signal && (error as NodeJS.ErrnoException)?.code !== "EEXIST")
      await cleanUpInterruptedWrite(key);
    throw error;
  }
}

function localPath(key: string): string {
  if (!/^[a-f0-9-]{36}\.webp$/.test(key))
    throw new DomainError(
      "RESOURCE_NOT_FOUND",
      "This image is unavailable.",
      404,
    );
  if (process.env.NODE_ENV === "production")
    throw new DomainError(
      "RESOURCE_NOT_FOUND",
      "This image is unavailable.",
      404,
    );
  return path.join(localDirectory(), key);
}
function s3Key(key: string): string {
  if (!/^s3:media\/[a-f0-9-]{36}\.webp$/.test(key))
    throw new DomainError(
      "RESOURCE_NOT_FOUND",
      "This image is unavailable.",
      404,
    );
  return key.slice(3);
}

export async function readPrivateImage(
  key: string,
): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array; length?: number }> {
  if (key.startsWith("supabase:")) {
    const objectKey = supabaseKey(key),
      { bucket } = supabaseConfig();
    const response = await supabaseRequest(
      `object/authenticated/${bucket}/${objectKey}`,
    );
    if (!(await requireSupabaseResponse(response, true)) || !response.body)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "This image is unavailable.",
        404,
      );
    const lengthHeader = response.headers.get("content-length"),
      length = lengthHeader === null ? undefined : Number(lengthHeader);
    return {
      body: response.body,
      ...(length !== undefined && Number.isSafeInteger(length) && length >= 0
        ? { length }
        : {}),
    };
  }
  if (key.startsWith("s3:")) {
    try {
      const object = await storageClient().send(
        new GetObjectCommand({
          Bucket: process.env.STORAGE_BUCKET,
          Key: s3Key(key),
        }),
      );
      if (!object.Body)
        throw new DomainError(
          "RESOURCE_NOT_FOUND",
          "This image is unavailable.",
          404,
        );
      return {
        body: object.Body.transformToWebStream(),
        length: object.ContentLength,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        ["NoSuchKey", "NotFound"].includes(String(error.name))
      )
        throw new DomainError(
          "RESOURCE_NOT_FOUND",
          "This image is unavailable.",
          404,
        );
      throw error;
    }
  }
  try {
    const data = await readFile(localPath(key));
    return { body: new Uint8Array(data), length: data.length };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "This image is unavailable.",
        404,
      );
    throw error;
  }
}

export async function deletePrivateImage(
  key: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (key.startsWith("supabase:")) {
    const objectKey = supabaseKey(key),
      { bucket } = supabaseConfig();
    const response = await supabaseRequest(`object/${bucket}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [objectKey] }),
      signal,
    });
    await requireSupabaseResponse(response, true);
    await response.body?.cancel().catch(() => {});
    return;
  }
  if (key.startsWith("s3:")) {
    await storageClient().send(
      new DeleteObjectCommand({
        Bucket: process.env.STORAGE_BUCKET,
        Key: s3Key(key),
      }),
      { abortSignal: signal },
    );
    return;
  }
  try {
    await unlink(localPath(key));
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
  }
}
