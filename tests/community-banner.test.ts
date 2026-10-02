import { describe, expect, it } from "vitest";
import {
  getCommunityBanner,
  getCommunityLetters,
} from "../src/lib/community-banner";

describe("community banner letters", () => {
  it.each([
    ["Star Wars", "SW"],
    ["Artificial Intelligence", "AI"],
    ["San Francisco Bay Area", "SF"],
    ["SF Restaurants", "SR"],
    ["Anthropic", "A"],
    ["Toronto", "T"],
    ["Seattle", "S"],
    ["a", "A"],
    ["ai", "AI"],
    ["nyc", "NYC"],
    ["a16z", "A16Z"],
    ["hello", "H"],
    ["  Star\t\n Wars   Fans ", "SW"],
    ["Café", "CAFÉ"],
    ["e\u0301cole", "É"],
    ["🇨🇦 Tech", "🇨🇦T"],
    ["", ""],
    [" \t\n ", ""],
  ])("uses the requested letters for %j", (name, letters) => {
    expect(getCommunityLetters(name)).toBe(letters);
  });
});

describe("shared community banner identity", () => {
  it("preserves the actual community name instead of substituting the city", () => {
    expect(
      getCommunityBanner({ name: "  SF   Restaurants ", city: "sf" }),
    ).toEqual({
      name: "SF Restaurants",
      letters: "SR",
      background: "#244670",
      foreground: "#ffffff",
    });
  });

  it.each([
    [null, "#244670", "#ffffff"],
    ["unknown", "#244670", "#ffffff"],
    ["new-york", "#40345b", "#ffffff"],
    ["toronto", "#713e43", "#ffffff"],
    ["seattle", "#2e5144", "#ffffff"],
    ["los-angeles", "#70523b", "#ffffff"],
  ])(
    "shares the %s banner colors with pure white text in social images",
    (city, background, foreground) => {
      expect(getCommunityBanner({ name: "Community", city })).toMatchObject({
        background,
        foreground,
      });
    },
  );
});
