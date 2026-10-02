import { EventEmitter } from "node:events";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { PassThrough } from "node:stream";
import sharp from "sharp";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { fetchOpenGraphPreview } from "../src/server/link-preview";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

type Fixture = {
  status?: number;
  headers?: Record<string, string | undefined>;
  body?: string | Buffer;
  chunks?: Buffer[];
  stall?: boolean;
  error?: Error;
};

const dnsLookup = vi.mocked(
  lookup as (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<LookupAddress[]>,
);

const PAGE = "https://news.example.com/story";
const IMAGE = "https://news.example.com/cover.png";
const fixtures = new Map<string, Fixture>();
const requests: { url: string; options: RequestOptions; address?: string }[] =
  [];
const responses: PassThrough[] = [];
let raster: Buffer;

function html(body: string, url = PAGE) {
  fixtures.set(url, { headers: { "content-type": "text/html" }, body });
}

function image(body = raster, url = IMAGE, type = "image/png") {
  fixtures.set(url, { headers: { "content-type": type }, body });
}

function requestFixture(
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
): ClientRequest {
  const record = {
    url: url.href,
    options,
    address: undefined as string | undefined,
  };
  requests.push(record);
  const request = new EventEmitter() as ClientRequest;
  let destroyed = false;
  let response: PassThrough | undefined;
  request.destroy = vi.fn((error?: Error) => {
    if (destroyed) return request;
    destroyed = true;
    response?.destroy();
    if (error) request.emit("error", error);
    return request;
  });
  request.end = vi.fn(() => {
    queueMicrotask(() => {
      if (destroyed) return;
      // Exercise the actual socket lookup callback, including its all-address
      // variant. It must use the already verified answer without new DNS work.
      options.lookup!(url.hostname, { all: true }, (error, addresses) => {
        if (error) request.emit("error", error);
        if (Array.isArray(addresses)) record.address = addresses[0]?.address;
      });
      const fixture = fixtures.get(url.href);
      if (!fixture) {
        request.emit("error", new Error(`Missing fixture for ${url.href}`));
        return;
      }
      if (fixture.error) {
        request.emit("error", fixture.error);
        return;
      }
      response = new PassThrough();
      responses.push(response);
      Object.assign(response, {
        statusCode: fixture.status ?? 200,
        headers: fixture.headers ?? {},
      });
      callback(response as unknown as IncomingMessage);
      if (response.destroyed) return;
      for (const chunk of fixture.chunks ?? [fixture.body ?? ""]) {
        if (!response.destroyed) response.write(chunk);
      }
      if (!fixture.stall && !response.destroyed) response.end();
    });
    return request;
  }) as ClientRequest["end"];
  options.signal?.addEventListener(
    "abort",
    () => request.destroy(new Error("Aborted")),
    { once: true },
  );
  return request;
}

beforeAll(async () => {
  raster = await sharp({
    create: { width: 1_600, height: 900, channels: 3, background: "#375cc4" },
  })
    .png()
    .toBuffer();
});

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.clear();
  requests.length = 0;
  responses.length = 0;
  dnsLookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  vi.mocked(httpRequest).mockImplementation(
    requestFixture as typeof httpRequest,
  );
  vi.mocked(httpsRequest).mockImplementation(
    requestFixture as typeof httpsRequest,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Open Graph preview images", () => {
  it("parses real metadata and entities, resolves a safe base, and normalizes the image", async () => {
    html(`<!doctype html><html><head>
      <!-- <meta property="og:image" content="https://comment.example.com/no.png"> -->
      <script>const fake = '<meta property="og:image" content="https://script.example.com/no.png">';</script>
      <template><meta property="og:image" content="https://template.example.com/no.png"></template>
      <META CONTENT="cover.png?width=1600&amp;crop=wide" PROPERTY="og:image">
      <base href="https://cdn.example.com/assets/">
    </head></html>`);
    const expected =
      "https://cdn.example.com/assets/cover.png?width=1600&crop=wide";
    image(raster, expected);
    const preview = await fetchOpenGraphPreview(PAGE);
    expect(preview).toMatchObject({ width: 1_200, height: 675 });
    expect((await sharp(preview!.data).metadata()).format).toBe("webp");
    expect(requests.map(({ url }) => url)).toEqual([PAGE, expected]);
  });

  it("prefers og:image:secure_url and supports protocol-relative images", async () => {
    html(
      '<meta property="og:image" content="http://cdn.example.com/cover.png"><meta property="og:image:secure_url" content="//cdn.example.com/secure.png">',
    );
    image(raster, "https://cdn.example.com/secure.png");
    expect(await fetchOpenGraphPreview(PAGE)).not.toBeNull();
    expect(requests[1].url).toBe("https://cdn.example.com/secure.png");
  });

  it("uses the final page URL for relative images after redirects", async () => {
    fixtures.set(PAGE, {
      status: 302,
      headers: { location: "/articles/story/" },
    });
    html(
      '<meta name="og:image" content="../cover.png">',
      "https://news.example.com/articles/story/",
    );
    image(raster, "https://news.example.com/articles/cover.png");
    expect(await fetchOpenGraphPreview(PAGE)).not.toBeNull();
    expect(requests.map(({ url }) => url)).toEqual([
      PAGE,
      "https://news.example.com/articles/story/",
      "https://news.example.com/articles/cover.png",
    ]);
  });

  it("falls back from an unavailable secure image to the original OG image", async () => {
    html(
      '<meta property="og:image" content="/cover.png"><meta property="og:image:secure_url" content="https://cdn.example.com/missing.png">',
    );
    fixtures.set("https://cdn.example.com/missing.png", { status: 404 });
    image();
    expect(await fetchOpenGraphPreview(PAGE)).not.toBeNull();
    expect(requests).toHaveLength(3);
  });

  it("ignores an unsafe base URL and an unsafe image candidate", async () => {
    html(
      '<base href="http://127.0.0.1/"><meta property="og:image" content="http://10.0.0.1/secret"><meta property="og:image" content="/cover.png">',
    );
    image();
    expect(await fetchOpenGraphPreview(PAGE)).not.toBeNull();
    expect(requests.map(({ url }) => url)).toEqual([PAGE, IMAGE]);
  });

  it("preserves small image dimensions", async () => {
    html('<meta property="og:image" content="/cover.png">');
    image(await sharp(raster).resize(320, 180).png().toBuffer());
    expect(await fetchOpenGraphPreview(PAGE)).toMatchObject({
      width: 320,
      height: 180,
    });
  });

  it.each([
    "<title>No image metadata</title>",
    '<!-- <meta property="og:image" content="/cover.png"> -->',
    '<script><meta property="og:image" content="/cover.png"></script>',
    '<meta property="twitter:image" content="/cover.png">',
  ])("returns a miss without fetching an image for %s", async (body) => {
    html(body);
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
    expect(requests).toHaveLength(1);
  });
});

describe("preview request isolation", () => {
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/cover.png",
    "https://user:password@example.com/",
    "https://example.com:8443/",
    "http://localhost/",
    "http://localhost./",
    "http://foo.localhost/",
    "http://service.local/",
    "http://metadata.google.internal/",
    "http://intranet/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.0.1/",
    "http://169.254.169.254/",
    "http://168.63.129.16/",
    "http://100.100.100.200/",
    "http://198.18.0.1/",
    "http://192.0.2.1/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:8.8.8.8]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[2001:db8::1]/",
    "http://[64:ff9b::a00:1]/",
    "http://[2002:7f00:1::]/",
    "http://[100::1]/",
    "http://[5f00::1]/",
  ])(
    "rejects nonpublic or unsupported URL %s without a request",
    async (url) => {
      expect(await fetchOpenGraphPreview(url)).toBeNull();
      expect(requests).toHaveLength(0);
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it.each([
    "127.0.0.1",
    "10.0.0.2",
    "::1",
    "fc00::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])(
    "rejects a DNS answer containing %s even alongside a public address",
    async (address) => {
      dnsLookup.mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address, family: address.includes(":") ? 6 : 4 },
      ]);
      expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
      expect(requests).toHaveLength(0);
    },
  );

  it("pins the actual request to the validated DNS answer", async () => {
    html("<title>No image</title>");
    dnsLookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(requests[0].address).toBe("8.8.8.8");
    expect(requests[0].options).toMatchObject({ agent: false });
    const callback = vi.fn();
    requests[0].options.lookup!("news.example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("supports public IPv6 answers and public literal addresses", async () => {
    dnsLookup.mockResolvedValue([
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    html('<meta property="og:image" content="https://8.8.8.8/cover.png">');
    image(raster, "https://8.8.8.8/cover.png");
    expect(await fetchOpenGraphPreview(PAGE)).not.toBeNull();
    expect(requests.map(({ address }) => address)).toEqual([
      "2606:4700:4700::1111",
      "8.8.8.8",
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each(["page", "image"])(
    "blocks private %s redirects before connecting",
    async (kind) => {
      html('<meta property="og:image" content="/cover.png">');
      fixtures.set(kind === "page" ? PAGE : IMAGE, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
      expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
      expect(requests).toHaveLength(kind === "page" ? 1 : 2);
    },
  );

  it("checks DNS again on a same-host redirect and blocks rebinding", async () => {
    fixtures.set(PAGE, { status: 302, headers: { location: "/new-location" } });
    dnsLookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(1);
  });

  it("resolves image hosts independently and rejects private image DNS", async () => {
    html(
      '<meta property="og:image" content="https://images.example.com/cover.png">',
    );
    dnsLookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "192.168.1.1", family: 4 }]);
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
    expect(requests).toHaveLength(1);
  });
});

describe("preview resource limits and misses", () => {
  it("limits redirect loops", async () => {
    fixtures.set(PAGE, { status: 302, headers: { location: PAGE } });
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
    expect(requests).toHaveLength(4);
  });

  it.each(["html", "image"])(
    "limits streamed %s bytes without trusting Content-Length",
    async (kind) => {
      html('<meta property="og:image" content="/cover.png">');
      const maxBytes = kind === "html" ? 1024 * 1024 : 8 * 1024 * 1024;
      fixtures.set(kind === "html" ? PAGE : IMAGE, {
        headers: {
          "content-type": kind === "html" ? "text/html" : "image/png",
        },
        chunks: [Buffer.alloc(maxBytes), Buffer.from("overflow")],
      });
      expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
      expect(responses.at(-1)?.destroyed).toBe(true);
    },
  );

  it("rejects oversized responses from Content-Length before reading them", async () => {
    fixtures.set(PAGE, {
      headers: { "content-type": "text/html", "content-length": "99999999" },
      stall: true,
    });
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
    expect(responses[0].destroyed).toBe(true);
  });

  it.each(["image/svg+xml", "image/png"])(
    "rejects SVG even when served as %s",
    async (type) => {
      html('<meta property="og:image" content="/cover.png">');
      image(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" /></svg>',
        ),
        IMAGE,
        type,
      );
      expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
    },
  );

  it("rejects corrupt raster images", async () => {
    html('<meta property="og:image" content="/cover.png">');
    image(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
  });

  it("rejects images exceeding the decoded pixel budget", async () => {
    html('<meta property="og:image" content="/cover.png">');
    image(
      await sharp({
        create: {
          width: 5_000,
          height: 5_000,
          channels: 3,
          background: "#fff",
        },
      })
        .png()
        .toBuffer(),
    );
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
  });

  it.each([
    { status: 403 },
    { headers: { "content-type": "application/json" }, body: "{}" },
    { headers: { "content-type": "text/html", "content-encoding": "gzip" } },
    { error: new Error("TLS certificate rejected") },
  ])("treats an unavailable or unsupported page as a miss", async (fixture) => {
    fixtures.set(PAGE, fixture);
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
  });

  it("returns a miss on DNS failure", async () => {
    dnsLookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await fetchOpenGraphPreview(PAGE)).toBeNull();
  });

  it("bounds stalled DNS by the overall deadline", async () => {
    vi.useFakeTimers();
    dnsLookup.mockReturnValue(new Promise(() => {}));
    const preview = fetchOpenGraphPreview(PAGE);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await preview).toBeNull();
    expect(requests).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled body within the same overall deadline", async () => {
    vi.useFakeTimers();
    fixtures.set(PAGE, {
      headers: { "content-type": "text/html" },
      body: "<html>",
      stall: true,
    });
    const preview = fetchOpenGraphPreview(PAGE);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await preview).toBeNull();
    expect(responses[0].destroyed).toBe(true);
    expect(requests[0].options.signal?.aborted).toBe(true);
  });
});
