import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import {
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactNode,
} from "react";
import { SocialImage } from "@/components/social-image";
import {
  getSiteUrl,
  SOCIAL_CANVAS_SIZE,
  SOCIAL_IMAGE_SIZE,
} from "@/lib/social-share";

// Local assets avoid a network request or font-provider dependency per image.
const assets = Promise.all([
  readFile(join(process.cwd(), "src/assets/fonts/Geist-Regular.ttf")),
  readFile(join(process.cwd(), "src/assets/fonts/Geist-Bold.ttf")),
  readFile(join(process.cwd(), "public/brand/reddix-logo.png")),
  // Satori requires PNG/JPEG; preserve the homepage photograph losslessly.
  readFile(join(process.cwd(), "public/brand/painted-ladies-hero.webp")).then(
    (wallpaper) => sharp(wallpaper).png().toBuffer(),
  ),
]);

const dimensionalStyle =
  /^(?:width|height|minWidth|minHeight|maxWidth|maxHeight|top|right|bottom|left|gap|rowGap|columnGap|fontSize|letterSpacing|wordSpacing|textIndent|(?:margin|padding)(?:Top|Right|Bottom|Left)?|border(?:Top|Right|Bottom|Left)?Width|border(?:TopLeft|TopRight|BottomLeft|BottomRight)?Radius)$/;

type SceneProps = {
  style?: CSSProperties;
  width?: number;
  height?: number;
  children?: ReactNode;
};

/** Scale the scene's native drawing coordinates, including its pure helpers.
 * Satori's ancestor transforms can misalign image and rotated-card clip paths.
 * Scaling before layout keeps those clips and SVG icons at full PNG resolution.
 */
function scaleScene(node: ReactNode, scale: number): ReactNode {
  if (Array.isArray(node)) {
    return node.map((child) => scaleScene(child, scale));
  }
  if (!isValidElement<SceneProps>(node)) return node;
  if (typeof node.type === "function") {
    const sceneComponent = node.type as (props: SceneProps) => ReactNode;
    return scaleScene(sceneComponent(node.props), scale);
  }

  const { style, width, height, children } = node.props;
  return cloneElement(
    node,
    {
      ...(style && {
        style: Object.fromEntries(
          Object.entries(style).map(([property, value]) => [
            property,
            typeof value === "number" && dimensionalStyle.test(property)
              ? value * scale
              : typeof value === "string"
                ? value.replace(
                    /(-?\d*\.?\d+)px\b/g,
                    (_, pixels: string) => `${Number(pixels) * scale}px`,
                  )
                : value,
          ]),
        ),
      }),
      ...(typeof width === "number" && { width: width * scale }),
      ...(typeof height === "number" && { height: height * scale }),
    },
    scaleScene(children, scale),
  );
}

export async function renderSocialImage() {
  const [regular, bold, logo, wallpaper] = await assets;
  const hostname = getSiteUrl().hostname;
  const scale = SOCIAL_IMAGE_SIZE.width / SOCIAL_CANVAS_SIZE.width;
  return new ImageResponse(
    <div style={{ ...SOCIAL_IMAGE_SIZE, display: "flex" }}>
      {scaleScene(
        <SocialImage
          logo={`data:image/png;base64,${logo.toString("base64")}`}
          wallpaper={`data:image/png;base64,${wallpaper.toString("base64")}`}
          hostname={
            hostname === "127.0.0.1" || hostname === "localhost"
              ? "reddix.co"
              : hostname
          }
        />,
        scale,
      )}
    </div>,
    {
      ...SOCIAL_IMAGE_SIZE,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: bold, weight: 700, style: "normal" },
      ],
      headers: {
        "Cache-Control":
          process.env.NODE_ENV === "development"
            ? "no-store"
            : "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
