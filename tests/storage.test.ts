import { randomUUID } from "node:crypto";
import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ send: vi.fn(), construct: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      constructor(config: Record<string, unknown>) {
        sdk.construct(config);
      }
      send = sdk.send;
    },
    PutObjectCommand: class PutObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
  };
});

let storage: typeof import("../src/server/storage");
const localFixtures = new Set<string>();
const storageEnv = [
  "STORAGE_PROVIDER",
  "STORAGE_BUCKET",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_ENDPOINT",
  "STORAGE_REGION",
] as const;

beforeEach(async () => {
  // The module caches its SDK client. Reset modules so one test's valid config
  // cannot accidentally make a later missing-credentials assertion pass.
  vi.resetModules();
  sdk.send.mockReset();
  sdk.construct.mockReset();
  vi.stubEnv("NODE_ENV", "test");
  for (const key of storageEnv) vi.stubEnv(key, undefined);
  storage = await import("../src/server/storage");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const file of localFixtures) {
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  localFixtures.clear();
});

function configureS3() {
  vi.stubEnv("STORAGE_BUCKET", "test-private-media");
  vi.stubEnv("STORAGE_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("STORAGE_SECRET_ACCESS_KEY", "test-secret-key");
  vi.stubEnv("STORAGE_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("STORAGE_REGION", "test-region");
}

describe("private object storage", () => {
  it("cancels a signaled S3 write and cleans up its fresh key with a separate deadline", async () => {
    configureS3();
    const controller = new AbortController();
    const failure = new Error("Preview deadline reached");
    const id = randomUUID();
    sdk.send.mockImplementation((command, options) => {
      if (command.constructor.name === "DeleteObjectCommand")
        return Promise.resolve({});
      return new Promise((_, reject) => {
        options.abortSignal.addEventListener(
          "abort",
          () => reject(options.abortSignal.reason),
          { once: true },
        );
      });
    });
    const write = storage.writePrivateImage(
      id,
      Buffer.from("image"),
      "image/webp",
      controller.signal,
    );
    const rejected = expect(write).rejects.toBe(failure);
    controller.abort(failure);
    await rejected;
    expect(sdk.send).toHaveBeenCalledTimes(2);
    const [upload, uploadOptions] = sdk.send.mock.calls[0];
    expect(upload.input.IfNoneMatch).toBe("*");
    expect(uploadOptions.abortSignal).toBe(controller.signal);
    const [cleanup, cleanupOptions] = sdk.send.mock.calls[1];
    expect(cleanup.constructor.name).toBe("DeleteObjectCommand");
    expect(cleanup.input.Key).toBe(`media/${id}.webp`);
    expect(cleanupOptions.abortSignal).toBeInstanceOf(AbortSignal);
    expect(cleanupOptions.abortSignal).not.toBe(controller.signal);
    expect(cleanupOptions.abortSignal.aborted).toBe(false);
  });

  it("cleans up a write that finishes concurrently with cancellation", async () => {
    configureS3();
    const controller = new AbortController();
    const failure = new Error("Preview deadline reached");
    sdk.send.mockImplementation(async (command) => {
      if (command.constructor.name === "PutObjectCommand")
        controller.abort(failure);
      return {};
    });
    await expect(
      storage.writePrivateImage(
        randomUUID(),
        Buffer.from("image"),
        "image/webp",
        controller.signal,
      ),
    ).rejects.toBe(failure);
    expect(sdk.send.mock.calls[1][0].constructor.name).toBe(
      "DeleteObjectCommand",
    );
  });

  it("does not clean up another object when a conditional S3 write is rejected", async () => {
    configureS3();
    const failure = Object.assign(new Error("Object already exists"), {
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 },
    });
    sdk.send.mockRejectedValue(failure);
    await expect(
      storage.writePrivateImage(
        randomUUID(),
        Buffer.from("image"),
        "image/webp",
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);
    expect(sdk.send).toHaveBeenCalledOnce();
  });

  it("rejects already-canceled writes and deletes before starting SDK work", async () => {
    configureS3();
    const failure = new Error("Canceled");
    const signal = AbortSignal.abort(failure);
    await expect(
      storage.writePrivateImage(
        randomUUID(),
        Buffer.from("image"),
        "image/webp",
        signal,
      ),
    ).rejects.toBe(failure);
    await expect(
      storage.deletePrivateImage(`s3:media/${randomUUID()}.webp`, signal),
    ).rejects.toBe(failure);
    expect(sdk.send).not.toHaveBeenCalled();
    expect(sdk.construct).not.toHaveBeenCalled();
  });

  it("passes a cleanup cancellation signal to S3", async () => {
    configureS3();
    const controller = new AbortController();
    const failure = new Error("Cleanup deadline reached");
    sdk.send.mockImplementation(
      (_, options) =>
        new Promise((_, reject) => {
          options.abortSignal.addEventListener(
            "abort",
            () => reject(options.abortSignal.reason),
            { once: true },
          );
        }),
    );
    const cleanup = storage.deletePrivateImage(
      `s3:media/${randomUUID()}.webp`,
      controller.signal,
    );
    const rejected = expect(cleanup).rejects.toBe(failure);
    controller.abort(failure);
    await rejected;
    expect(sdk.send.mock.calls[0][1].abortSignal).toBe(controller.signal);
  });

  it("writes private objects without an ACL or public caching", async () => {
    configureS3();
    sdk.send.mockResolvedValue({});
    const id = randomUUID(),
      data = Buffer.from("normalized image bytes");

    await expect(
      storage.writePrivateImage(id, data, "image/webp"),
    ).resolves.toBe(`s3:media/${id}.webp`);

    const [command] = sdk.send.mock.calls[0];
    expect(command.constructor.name).toBe("PutObjectCommand");
    expect(command.input).toEqual({
      Bucket: "test-private-media",
      Key: `media/${id}.webp`,
      Body: data,
      ContentType: "image/webp",
      ContentLength: data.length,
      CacheControl: "private, no-store",
    });
    expect(command.input).not.toHaveProperty("ACL");
    expect(sdk.construct).toHaveBeenCalledWith({
      region: "test-region",
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
      endpoint: "https://storage.example.test",
      forcePathStyle: true,
      maxAttempts: 3,
    });
  });

  it("returns an S3 response as a web stream with its content length", async () => {
    configureS3();
    const id = randomUUID(),
      bytes = new Uint8Array([1, 2, 3, 4]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const transformToWebStream = vi.fn(() => stream);
    sdk.send.mockResolvedValue({
      Body: { transformToWebStream },
      ContentLength: bytes.length,
    });

    const object = await storage.readPrivateImage(`s3:media/${id}.webp`);

    expect(object.body).toBe(stream);
    expect(object.length).toBe(bytes.length);
    expect(
      new Uint8Array(await new Response(object.body as BodyInit).arrayBuffer()),
    ).toEqual(bytes);
    expect(transformToWebStream).toHaveBeenCalledOnce();
    const [command] = sdk.send.mock.calls[0];
    expect(command.constructor.name).toBe("GetObjectCommand");
    expect(command.input).toEqual({
      Bucket: "test-private-media",
      Key: `media/${id}.webp`,
    });
  });

  it("deletes the same private key returned by an upload", async () => {
    configureS3();
    sdk.send.mockResolvedValue({});
    const id = randomUUID(),
      key = await storage.writePrivateImage(
        id,
        Buffer.from("image"),
        "image/webp",
      );

    await expect(storage.deletePrivateImage(key)).resolves.toBeUndefined();

    const [command] = sdk.send.mock.calls[1];
    expect(command.constructor.name).toBe("DeleteObjectCommand");
    expect(command.input).toEqual({
      Bucket: "test-private-media",
      Key: `media/${id}.webp`,
    });
  });

  it.each(["NoSuchKey", "NotFound"])(
    "maps an S3 %s error to a missing resource",
    async (name) => {
      configureS3();
      sdk.send.mockRejectedValue(
        Object.assign(new Error("Object missing"), { name }),
      );
      await expect(
        storage.readPrivateImage(`s3:media/${randomUUID()}.webp`),
      ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
    },
  );

  it("treats an empty S3 body as unavailable", async () => {
    configureS3();
    sdk.send.mockResolvedValue({});
    await expect(
      storage.readPrivateImage(`s3:media/${randomUUID()}.webp`),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
  });

  it("propagates provider outages and cleanup failures", async () => {
    configureS3();
    const error = new Error("Storage unavailable");
    sdk.send.mockRejectedValue(error);
    const key = `s3:media/${randomUUID()}.webp`;
    await expect(storage.readPrivateImage(key)).rejects.toBe(error);
    await expect(storage.deletePrivateImage(key)).rejects.toBe(error);
  });

  it.each([
    "s3:../../private.webp",
    "s3:media/../../private.webp",
    "s3:media/not-an-id.webp",
    "../private.webp",
  ])("rejects an unsafe object key %s before an SDK operation", async (key) => {
    configureS3();
    await expect(storage.readPrivateImage(key)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
    await expect(storage.deletePrivateImage(key)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
    expect(sdk.send).not.toHaveBeenCalled();
  });
});

describe("production storage configuration", () => {
  it.each([
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY",
  ] as const)("fails closed when %s is missing", async (missing) => {
    configureS3();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(missing, undefined);
    await expect(
      storage.writePrivateImage(
        randomUUID(),
        Buffer.from("image"),
        "image/webp",
      ),
    ).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED", status: 503 });
    expect(sdk.send).not.toHaveBeenCalled();
    expect(sdk.construct).not.toHaveBeenCalled();
  });

  it.each([
    "http://storage.example.test",
    "not-a-url",
    "https://user:secret@storage.example.test",
    "file:///tmp/media",
  ])("rejects an unsafe production endpoint %s", async (endpoint) => {
    configureS3();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STORAGE_ENDPOINT", endpoint);
    await expect(
      storage.writePrivateImage(
        randomUUID(),
        Buffer.from("image"),
        "image/webp",
      ),
    ).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED", status: 503 });
    expect(sdk.send).not.toHaveBeenCalled();
    expect(sdk.construct).not.toHaveBeenCalled();
  });

  it("refuses local storage reads and deletes in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const key = `${randomUUID()}.webp`;
    await expect(storage.readPrivateImage(key)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
    await expect(storage.deletePrivateImage(key)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
  });
});

describe("local development storage", () => {
  it("preserves an existing local image after signaled conflicts and canceled operations", async () => {
    const id = randomUUID();
    const bytes = Buffer.from("original local image");
    const file = path.join(process.cwd(), ".data", "media", `${id}.webp`);
    localFixtures.add(file);
    const key = await storage.writePrivateImage(
      id,
      bytes,
      "image/webp",
      new AbortController().signal,
    );
    await expect(
      storage.writePrivateImage(
        id,
        Buffer.from("replacement"),
        "image/webp",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "EEXIST" });
    const failure = new Error("Canceled");
    const signal = AbortSignal.abort(failure);
    await expect(
      storage.writePrivateImage(
        id,
        Buffer.from("replacement"),
        "image/webp",
        signal,
      ),
    ).rejects.toBe(failure);
    await expect(storage.deletePrivateImage(key, signal)).rejects.toBe(failure);
    expect(await readFile(file)).toEqual(bytes);
  });

  it("writes owner-only files, preserves an existing image, reads bytes, and cleans up idempotently", async () => {
    const id = randomUUID(),
      bytes = Buffer.from("local normalized WebP fixture");
    const file = path.join(process.cwd(), ".data", "media", `${id}.webp`);
    localFixtures.add(file);

    const key = await storage.writePrivateImage(id, bytes, "image/webp");
    expect(key).toBe(`${id}.webp`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(
      storage.writePrivateImage(id, Buffer.from("replacement"), "image/webp"),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(file)).toEqual(bytes);
    const object = await storage.readPrivateImage(key);
    expect(object.body).toEqual(new Uint8Array(bytes));
    expect(object.length).toBe(bytes.length);

    await storage.deletePrivateImage(key);
    await expect(storage.readPrivateImage(key)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
    await expect(storage.deletePrivateImage(key)).resolves.toBeUndefined();
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it("rejects path traversal in upload identifiers", async () => {
    await expect(
      storage.writePrivateImage(
        "../private",
        Buffer.from("image"),
        "image/webp",
      ),
    ).rejects.toThrow("Invalid private image identifier");
    expect(sdk.send).not.toHaveBeenCalled();
  });
});
