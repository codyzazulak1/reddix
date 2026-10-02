import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deletePrivateImage,
  readPrivateImage,
  writePrivateImage,
} from "../src/server/storage";

const request = vi.fn<typeof fetch>();
const project = "https://test-project.supabase.co";
const bucket = "private-media";
const secret = "sb_secret_test_server_only";
const privateBucket = () => Response.json({ id: bucket, public: false });

beforeEach(() => {
  request.mockReset();
  vi.stubGlobal("fetch", request);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("STORAGE_PROVIDER", "supabase");
  vi.stubEnv("SUPABASE_URL", project);
  vi.stubEnv("SUPABASE_SECRET_KEY", secret);
  vi.stubEnv("STORAGE_BUCKET", bucket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("private Supabase Storage", () => {
  it("cancels bucket validation before attempting an upload", async () => {
    const controller = new AbortController();
    const failure = new Error("Preview deadline reached");
    request.mockImplementation(
      (_, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        }),
    );
    const write = writePrivateImage(
      randomUUID(),
      Buffer.from("image"),
      "image/webp",
      controller.signal,
    );
    const rejected = expect(write).rejects.toBe(failure);
    controller.abort(failure);
    await rejected;
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("cancels an upload with the same deadline and uses a fresh signal for cleanup", async () => {
    const controller = new AbortController();
    const failure = new Error("Preview deadline reached");
    const id = randomUUID();
    let started!: () => void;
    const uploading = new Promise<void>((resolve) => {
      started = resolve;
    });
    request.mockResolvedValueOnce(privateBucket());
    request.mockImplementationOnce(
      (_, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
          started();
        }),
    );
    request.mockResolvedValueOnce(Response.json([]));
    const write = writePrivateImage(
      id,
      Buffer.from("image"),
      "image/webp",
      controller.signal,
    );
    const rejected = expect(write).rejects.toBe(failure);
    await uploading;
    controller.abort(failure);
    await rejected;
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true);
    const [, cleanup] = request.mock.calls[2];
    expect(cleanup?.method).toBe("DELETE");
    expect(cleanup?.body).toBe(
      JSON.stringify({ prefixes: [`media/${id}.webp`] }),
    );
    expect(cleanup?.signal?.aborted).toBe(false);
  });

  it("cleans up an upload whose success races cancellation", async () => {
    const controller = new AbortController();
    const failure = new Error("Preview deadline reached");
    request.mockResolvedValueOnce(privateBucket());
    request.mockImplementationOnce(async () => {
      controller.abort(failure);
      return Response.json({ Key: "ignored" });
    });
    request.mockResolvedValueOnce(Response.json([]));
    await expect(
      writePrivateImage(
        randomUUID(),
        Buffer.from("image"),
        "image/webp",
        controller.signal,
      ),
    ).rejects.toBe(failure);
    expect(request.mock.calls[2][1]?.method).toBe("DELETE");
  });

  it("preserves an existing object when the non-upserting upload is rejected", async () => {
    request.mockResolvedValueOnce(privateBucket());
    request.mockResolvedValueOnce(
      Response.json({ code: "ResourceAlreadyExists" }, { status: 409 }),
    );
    await expect(
      writePrivateImage(
        randomUUID(),
        Buffer.from("image"),
        "image/webp",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects pre-canceled storage writes and deletes without a request", async () => {
    const failure = new Error("Canceled");
    const signal = AbortSignal.abort(failure);
    await expect(
      writePrivateImage(
        randomUUID(),
        Buffer.from("image"),
        "image/webp",
        signal,
      ),
    ).rejects.toBe(failure);
    await expect(
      deletePrivateImage(`supabase:media/${randomUUID()}.webp`, signal),
    ).rejects.toBe(failure);
    expect(request).not.toHaveBeenCalled();
  });

  it("cancels an in-flight cleanup request at its deadline", async () => {
    const controller = new AbortController();
    const failure = new Error("Cleanup deadline reached");
    request.mockImplementation(
      (_, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        }),
    );
    const cleanup = deletePrivateImage(
      `supabase:media/${randomUUID()}.webp`,
      controller.signal,
    );
    const rejected = expect(cleanup).rejects.toBe(failure);
    controller.abort(failure);
    await rejected;
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("checks bucket privacy and uploads immutable bytes with server API key authentication", async () => {
    request.mockResolvedValueOnce(privateBucket());
    request.mockResolvedValueOnce(Response.json({ Key: "ignored" }));
    const id = randomUUID(),
      bytes = Buffer.from("normalized WebP");

    await expect(writePrivateImage(id, bytes, "image/webp")).resolves.toBe(
      `supabase:media/${id}.webp`,
    );

    expect(request.mock.calls[0][0]).toBe(
      `${project}/storage/v1/bucket/${bucket}`,
    );
    const [url, init] = request.mock.calls[1];
    expect(url).toBe(`${project}/storage/v1/object/${bucket}/media/${id}.webp`);
    expect(init).toMatchObject({
      method: "POST",
      body: new Uint8Array(bytes),
      cache: "no-store",
      redirect: "error",
      headers: {
        apikey: secret,
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "x-upsert": "false",
      },
    });
    for (const [url, init] of request.mock.calls) {
      expect(String(url)).not.toContain(secret);
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    { id: bucket, public: true },
    { id: bucket },
    { id: "different-bucket", public: false },
    { id: bucket, public: "false" },
  ])(
    "refuses uploads if bucket privacy cannot be confirmed (%j)",
    async (metadata) => {
      request.mockResolvedValueOnce(Response.json(metadata));
      await expect(
        writePrivateImage(randomUUID(), Buffer.from("image"), "image/webp"),
      ).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED", status: 503 });
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it("reads through the authenticated endpoint and preserves the private byte stream", async () => {
    const id = randomUUID(),
      bytes = new Uint8Array([1, 2, 3]);
    request.mockResolvedValueOnce(
      new Response(bytes, { headers: { "Content-Length": "3" } }),
    );

    const result = await readPrivateImage(`supabase:media/${id}.webp`);

    expect(request).toHaveBeenCalledWith(
      `${project}/storage/v1/object/authenticated/${bucket}/media/${id}.webp`,
      expect.objectContaining({
        headers: { apikey: secret },
        redirect: "error",
        cache: "no-store",
      }),
    );
    expect(result.length).toBe(3);
    expect(
      new Uint8Array(await new Response(result.body as BodyInit).arrayBuffer()),
    ).toEqual(bytes);
  });

  it.each([undefined, "invalid", "-1"])(
    "omits unavailable or invalid content lengths (%s)",
    async (length) => {
      request.mockResolvedValueOnce(
        new Response("image", {
          headers: length ? { "Content-Length": length } : undefined,
        }),
      );
      const result = await readPrivateImage(
        `supabase:media/${randomUUID()}.webp`,
      );
      expect(result.length).toBeUndefined();
    },
  );

  it("deletes only the requested object through the API, never directly from storage tables", async () => {
    request.mockResolvedValueOnce(Response.json([]));
    const id = randomUUID();
    await expect(
      deletePrivateImage(`supabase:media/${id}.webp`),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      `${project}/storage/v1/object/${bucket}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ prefixes: [`media/${id}.webp`] }),
        headers: { apikey: secret, "Content-Type": "application/json" },
      }),
    );
  });

  it.each([
    [404, {}],
    [400, { code: "NoSuchKey" }],
    [400, { statusCode: "404" }],
  ])(
    "maps missing objects to 404 and makes deletion idempotent (%s, %j)",
    async (status, detail) => {
      request.mockImplementation(async () => Response.json(detail, { status }));
      const key = `supabase:media/${randomUUID()}.webp`;
      await expect(readPrivateImage(key)).rejects.toMatchObject({
        code: "RESOURCE_NOT_FOUND",
        status: 404,
      });
      await expect(deletePrivateImage(key)).resolves.toBeUndefined();
    },
  );

  it.each([401, 403, 429, 500])(
    "hides provider details and preserves failures for retry (%s)",
    async (status) => {
      request.mockImplementation(async () =>
        Response.json({ message: `private detail ${secret}` }, { status }),
      );
      const key = `supabase:media/${randomUUID()}.webp`;
      for (const operation of [readPrivateImage, deletePrivateImage]) {
        const error = await operation(key).catch((error: Error) => error);
        expect(error).toMatchObject({
          code: "STORAGE_UNAVAILABLE",
          status: 503,
        });
        expect(String(error)).not.toContain(secret);
        expect(String(error)).not.toContain("private detail");
      }
    },
  );

  it("hides transport, timeout, and rejected redirect errors", async () => {
    request.mockRejectedValue(
      new Error(`fetch failed at ${project} with ${secret}`),
    );
    await expect(
      readPrivateImage(`supabase:media/${randomUUID()}.webp`),
    ).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      message:
        "Private image storage is temporarily unavailable. Please try again.",
    });
  });

  it.each([
    "supabase:../../private.webp",
    "supabase:media/../../private.webp",
    "supabase:media/not-an-id.webp",
    `supabase:media/${randomUUID()}.webp?public=true`,
  ])(
    "rejects invalid object paths without contacting Supabase (%s)",
    async (key) => {
      await expect(readPrivateImage(key)).rejects.toMatchObject({
        status: 404,
      });
      await expect(deletePrivateImage(key)).rejects.toMatchObject({
        status: 404,
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
});

describe("Supabase configuration", () => {
  it.each([
    ["SUPABASE_URL", undefined],
    ["SUPABASE_URL", "http://test-project.supabase.co"],
    ["SUPABASE_URL", "https://test-project.supabase.co/storage/v1"],
    ["SUPABASE_URL", "https://test-project.supabase.co?apikey=secret"],
    ["SUPABASE_URL", "https://test-project.supabase.co#fragment"],
    ["SUPABASE_URL", "https://user:secret@test-project.supabase.co"],
    ["SUPABASE_SECRET_KEY", undefined],
    ["SUPABASE_SECRET_KEY", "sb_publishable_not-a-server-secret"],
    ["STORAGE_BUCKET", undefined],
    ["STORAGE_BUCKET", "../another-bucket"],
    ["STORAGE_PROVIDER", "supabse"],
  ])(
    "fails closed before sending a request when %s is %s",
    async (key, value) => {
      vi.stubEnv(key, value);
      await expect(
        writePrivateImage(randomUUID(), Buffer.from("image"), "image/webp"),
      ).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED", status: 503 });
      expect(request).not.toHaveBeenCalled();
    },
  );
});
