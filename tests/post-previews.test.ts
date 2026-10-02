import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Member, Post } from "../src/lib/types";
import { ensureAuthDatabase } from "../src/lib/auth-store";
import { currentMember } from "../src/lib/auth-session";
import { GET as readMedia } from "../src/app/api/media/[id]/route";
import { performAction } from "../src/server/actions";
import { sql } from "../src/server/db";
import { fetchOpenGraphPreview } from "../src/server/link-preview";
import { getMemberById } from "../src/server/members";
import { postPreviewUrl } from "../src/server/post-preview";
import { getPosts } from "../src/server/queries";
import {
  deletePrivateImage,
  readPrivateImage,
  writePrivateImage,
} from "../src/server/storage";
import { enqueuePostPromotion } from "../src/server/x-growth";

vi.mock("../src/server/link-preview", () => ({
  fetchOpenGraphPreview: vi.fn(),
}));
vi.mock("../src/server/storage", () => ({
  writePrivateImage: vi.fn(),
  readPrivateImage: vi.fn(),
  deletePrivateImage: vi.fn(),
}));
vi.mock("../src/lib/auth-session", () => ({ currentMember: vi.fn() }));
vi.mock("../src/server/x-growth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/server/x-growth")>();
  return {
    ...actual,
    enqueuePostPromotion: vi.fn(actual.enqueuePostPromotion),
  };
});

describe("post preview link selection", () => {
  it("prefers the submitted link over links in the body", () => {
    expect(
      postPreviewUrl(
        "https://example.com/submitted",
        "Discuss https://example.com/body instead.",
      ),
    ).toBe("https://example.com/submitted");
  });

  it.each([
    [
      "Read https://example.com/first then https://example.com/second",
      "https://example.com/first",
    ],
    [
      "[Read this article](https://example.com/story)",
      "https://example.com/story",
    ],
    ["<https://example.com/story>", "https://example.com/story"],
    ["Read https://example.com/story.", "https://example.com/story"],
    [
      "Read https://example.com/story, then discuss.",
      "https://example.com/story",
    ],
    ["Read this (https://example.com/story).", "https://example.com/story"],
    [
      "Read https://example.com/wiki/Topic_(detail).",
      "https://example.com/wiki/Topic_(detail)",
    ],
    ["Older article: http://example.com/story", "http://example.com/story"],
    ["No links in this discussion.", null],
    ["ftp://example.com/file and mailto:hello@example.com", null],
  ])("extracts the first web link from %j", (body, expected) => {
    expect(postPreviewUrl(null, body!)).toBe(expected);
  });
});

describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "post Open Graph previews",
  () => {
    const prefix = `post-preview-${randomUUID()}`;
    const authorId = `${prefix}-author`;
    const readerId = `${prefix}-reader`;
    const memberIds = [authorId, readerId];
    const communityId = `${prefix}-community`;
    const bytes = Buffer.from("normalized fixture WebP image");
    let author: Member, reader: Member;

    async function create(overrides: Record<string, unknown> = {}) {
      const result = await performAction(author, {
        action: "createPost",
        communityId,
        title: "Preview fixture discussion",
        type: "link",
        url: "https://example.com/article",
        ...overrides,
      });
      return result.post as Post;
    }

    async function upload(ownerId = authorId) {
      const id = randomUUID();
      await sql`INSERT INTO media_assets(id,owner_id,storage_key,mime_type,byte_size,width,height)
        VALUES(${id},${ownerId},${`${id}.webp`},'image/webp',${bytes.length},1200,630)`;
      return `/api/media/${id}`;
    }

    async function assetCount() {
      const [row] =
        await sql`SELECT count(*)::int AS count FROM media_assets WHERE owner_id=${authorId}`;
      return row.count as number;
    }

    beforeAll(async () => {
      expect(["127.0.0.1", "localhost"]).toContain(
        new URL(
          process.env.DATABASE_URL ??
            "postgresql://reddix@127.0.0.1:55432/reddix",
        ).hostname,
      );
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("AUTH_MODE", "development");
      vi.stubEnv("AUTO_MIGRATE", "1");
      await ensureAuthDatabase();
      for (const id of memberIds)
        await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_expires_at,admitted_at,onboarding_completed_at)
          VALUES(${id},${id},'Post Preview Fixture',${id},'blue',now()+interval '1 day',now(),now())`;
      await sql`INSERT INTO communities(id,slug,name,description)
        VALUES(${communityId},${communityId},'Post Preview Fixtures','Synthetic preview tests.')`;
      author = (await getMemberById(authorId))!;
      reader = (await getMemberById(readerId))!;
    }, 30000);

    beforeEach(async () => {
      vi.clearAllMocks();
      vi.mocked(fetchOpenGraphPreview).mockReset().mockResolvedValue({
        data: bytes,
        width: 1200,
        height: 630,
      });
      vi.mocked(writePrivateImage)
        .mockReset()
        .mockImplementation(async (id) => `${id}.webp`);
      vi.mocked(deletePrivateImage).mockReset().mockResolvedValue(undefined);
      vi.mocked(readPrivateImage)
        .mockReset()
        .mockResolvedValue({
          body: new Uint8Array(bytes),
          length: bytes.length,
        });
      vi.mocked(currentMember).mockReset().mockResolvedValue(reader);
      await sql`DELETE FROM rate_limits WHERE key=${`action:${authorId}:createPost`}`;
    });

    afterAll(async () => {
      // All writes and cleanup stay within this run's fixture users and sub.
      await sql`DELETE FROM moderation_jobs WHERE target_type='post' AND target_id IN (SELECT id FROM posts WHERE author_id=${authorId})`;
      await sql`DELETE FROM x_outbox WHERE kind='post' AND resource_id IN (SELECT id FROM posts WHERE author_id=${authorId})`;
      await sql`DELETE FROM media_assets WHERE owner_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM post_votes WHERE user_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM posts WHERE author_id=${authorId}`;
      await sql`DELETE FROM blocks WHERE user_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM rate_limits WHERE key LIKE ${`action:${prefix}%`}`;
      await sql`DELETE FROM communities WHERE id=${communityId}`;
      await sql`DELETE FROM users WHERE id IN ${sql(memberIds)}`;
      vi.unstubAllEnvs();
    });

    it("publishes a link with a private preview returned by the feed", async () => {
      const post = await create({
        body: "Related: https://example.com/secondary",
      });
      expect(fetchOpenGraphPreview).toHaveBeenCalledExactlyOnceWith(
        "https://example.com/article",
      );
      expect(post).toMatchObject({
        type: "link",
        url: "https://example.com/article",
        status: "published",
      });
      expect(post.imageUrl).toMatch(/^\/api\/media\/[a-f0-9-]{36}$/);
      const assetId = post.imageUrl!.split("/").pop()!;
      expect(writePrivateImage).toHaveBeenCalledExactlyOnceWith(
        assetId,
        bytes,
        "image/webp",
        expect.any(AbortSignal),
      );
      const [asset] = await sql`SELECT * FROM media_assets WHERE id=${assetId}`;
      expect(asset).toMatchObject({
        owner_id: authorId,
        attached_post_id: post.id,
        storage_key: `${assetId}.webp`,
        mime_type: "image/webp",
        byte_size: bytes.length,
        width: 1200,
        height: 630,
      });
      expect((await getPosts(readerId, post.id))[0].imageUrl).toBe(
        post.imageUrl,
      );
      expect(deletePrivateImage).not.toHaveBeenCalled();
    });

    it.each([
      "Read https://example.com/story, then discuss it.",
      "[Read the story](https://example.com/story) before discussing.",
    ])("adds a preview to a text post containing %j", async (body) => {
      const post = await create({ type: "text", body, url: null });
      expect(fetchOpenGraphPreview).toHaveBeenCalledExactlyOnceWith(
        "https://example.com/story",
      );
      expect(post).toMatchObject({ type: "text", body, url: null });
      expect(post.imageUrl).toMatch(/^\/api\/media\/[a-f0-9-]{36}$/);
    });

    it("skips preview fetching when the post has no link", async () => {
      const before = await assetCount();
      const post = await create({
        type: "text",
        body: "A discussion without links.",
        url: null,
      });
      expect(post.imageUrl).toBeNull();
      expect(fetchOpenGraphPreview).not.toHaveBeenCalled();
      expect(writePrivateImage).not.toHaveBeenCalled();
      expect(await assetCount()).toBe(before);
    });

    it("preserves an uploaded image when its caption contains a link", async () => {
      const imageUrl = await upload();
      const post = await create({
        type: "image",
        imageUrl,
        body: "Photo from https://example.com/story",
      });
      expect(post.imageUrl).toBe(imageUrl);
      expect(fetchOpenGraphPreview).not.toHaveBeenCalled();
      expect(writePrivateImage).not.toHaveBeenCalled();
      const [asset] =
        await sql`SELECT attached_post_id FROM media_assets WHERE id=${imageUrl.split("/").pop()!}`;
      expect(asset.attached_post_id).toBe(post.id);
    });

    it("still rejects another member's uploaded image before fetching links", async () => {
      const imageUrl = await upload(readerId);
      await expect(
        create({ type: "image", imageUrl, body: "https://example.com/story" }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(fetchOpenGraphPreview).not.toHaveBeenCalled();
      expect(writePrivateImage).not.toHaveBeenCalled();
    });

    it.each(["missing", "fetch error", "storage error"])(
      "publishes without an image after a preview %s",
      async (failure) => {
        const before = await assetCount();
        if (failure === "missing")
          vi.mocked(fetchOpenGraphPreview).mockResolvedValueOnce(null);
        if (failure === "fetch error")
          vi.mocked(fetchOpenGraphPreview).mockRejectedValueOnce(
            new Error("Fixture fetch failure"),
          );
        if (failure === "storage error")
          vi.mocked(writePrivateImage).mockRejectedValueOnce(
            new Error("Fixture storage failure"),
          );
        const post = await create();
        expect(post.status).toBe("published");
        expect(post.imageUrl).toBeNull();
        expect((await getPosts(readerId, post.id))[0].imageUrl).toBeNull();
        expect(await assetCount()).toBe(before);
        if (failure !== "storage error")
          expect(writePrivateImage).not.toHaveBeenCalled();
      },
    );

    it("rolls back the preview asset and deletes staged bytes if publishing fails", async () => {
      const before = await assetCount();
      const failure = new Error("Fixture transaction failure");
      vi.mocked(enqueuePostPromotion).mockRejectedValueOnce(failure);
      await expect(
        create({ title: "Rolled back preview fixture" }),
      ).rejects.toBe(failure);
      const assetId = vi.mocked(writePrivateImage).mock.calls[0][0];
      expect(deletePrivateImage).toHaveBeenCalledExactlyOnceWith(
        `${assetId}.webp`,
        expect.any(AbortSignal),
      );
      expect(await assetCount()).toBe(before);
      expect(
        await sql`SELECT id FROM posts WHERE author_id=${authorId} AND title='Rolled back preview fixture'`,
      ).toHaveLength(0);
    });

    it("retains an uploaded image for retry if publishing fails", async () => {
      const imageUrl = await upload();
      const failure = new Error("Fixture upload transaction failure");
      vi.mocked(enqueuePostPromotion).mockRejectedValueOnce(failure);
      await expect(create({ type: "image", imageUrl })).rejects.toBe(failure);
      const [asset] =
        await sql`SELECT attached_post_id FROM media_assets WHERE id=${imageUrl.split("/").pop()!}`;
      expect(asset.attached_post_id).toBeNull();
      expect(deletePrivateImage).not.toHaveBeenCalled();
    });

    it("serves previews only while the viewer can read the published post", async () => {
      const post = await create();
      const id = post.imageUrl!.split("/").pop()!;
      const request = () =>
        readMedia(new Request(`http://localhost${post.imageUrl}`), {
          params: Promise.resolve({ id }),
        });
      const visible = await request();
      expect(visible.status).toBe(200);
      expect(visible.headers.get("cache-control")).toBe("private, no-store");
      expect(Buffer.from(await visible.arrayBuffer())).toEqual(bytes);
      vi.mocked(readPrivateImage).mockClear();

      vi.mocked(currentMember).mockResolvedValueOnce(null);
      expect((await request()).status).toBe(401);
      await sql`INSERT INTO blocks(user_id,blocked_id) VALUES(${readerId},${authorId})`;
      expect((await request()).status).toBe(404);
      await sql`DELETE FROM blocks WHERE user_id=${readerId} AND blocked_id=${authorId}`;
      await sql`UPDATE posts SET status='removed' WHERE id=${post.id}`;
      expect((await request()).status).toBe(404);
      expect(readPrivateImage).not.toHaveBeenCalled();
    });
  },
);
