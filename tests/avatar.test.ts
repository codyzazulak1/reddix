import { describe, expect, it } from "vitest";
import { highResolutionAvatar } from "../src/lib/avatar";
import { parseXProfile } from "../src/lib/auth-x";

describe("X avatar resolution", () => {
  it.each(["normal", "mini", "bigger"])("upgrades %s thumbnails", (size) => {
    expect(
      highResolutionAvatar(
        `https://pbs.twimg.com/profile_images/123/photo_${size}.jpg?x=1`,
      ),
    ).toBe("https://pbs.twimg.com/profile_images/123/photo_400x400.jpg?x=1");
  });

  it.each([
    null,
    "/brand/reddix-logo.png",
    "invalid URL",
    "https://example.com/profile_images/123/photo_normal.jpg",
    "https://pbs.twimg.com.evil.test/profile_images/123/photo_normal.jpg",
    "https://pbs.twimg.com/media/photo_normal.jpg",
    "https://pbs.twimg.com/profile_images/123/photo.jpg",
    "https://pbs.twimg.com/profile_images/123/photo_400x400.jpg",
  ])("preserves non-thumbnail image %s", (url) => {
    expect(highResolutionAvatar(url)).toBe(url);
  });

  it("stores the higher resolution URL when parsing a synced X profile", () => {
    expect(
      parseXProfile({
        id: "123",
        name: "CZ",
        username: "codyzaz",
        profile_image_url:
          "https://pbs.twimg.com/profile_images/123/photo_normal.jpg",
      }).avatar,
    ).toBe("https://pbs.twimg.com/profile_images/123/photo_400x400.jpg");
  });
});
