type BannerColors = { background: string; foreground: string };

const defaultColors: BannerColors = {
  background: "#244670",
  foreground: "#ffffff",
};

const cityColors = new Map<string, BannerColors>([
  ["new-york", { background: "#40345b", foreground: "#ffffff" }],
  ["toronto", { background: "#713e43", foreground: "#ffffff" }],
  ["seattle", { background: "#2e5144", foreground: "#ffffff" }],
  ["los-angeles", { background: "#70523b", foreground: "#ffffff" }],
]);

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function normalizeName(name: string) {
  return name.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function getCommunityLetters(name: string): string {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return "";

  const words = normalizedName.split(" ");
  const characters = (word: string) =>
    Array.from(graphemes.segment(word), ({ segment }) => segment);

  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => characters(word)[0])
      .join("")
      .toUpperCase();
  }

  const letters = characters(normalizedName);
  return (letters.length > 4 ? letters[0] : normalizedName).toUpperCase();
}

export function getCommunityBanner({
  name,
  city,
}: {
  name: string;
  city: string | null;
}): {
  name: string;
  letters: string;
  background: string;
  foreground: string;
} {
  const normalizedName = normalizeName(name);

  return {
    name: normalizedName,
    letters: getCommunityLetters(normalizedName),
    ...(cityColors.get(city ?? "") ?? defaultColors),
  };
}
