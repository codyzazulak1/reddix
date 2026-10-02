# Social share images

The main card is a native 2400 × 1260 PNG, displayed on a 1200 × 630 screenshot canvas.
Text and vector artwork render at twice the canvas resolution for crisp high-density
screens. The screenshot pages have no application shell, controls, or navigation
links, and are marked `noindex, nofollow`.

| Purpose          | Preview page | PNG         |
| ---------------- | ------------ | ----------- |
| Main Reddix card | `/og`        | `/og/image` |

Open a preview with a 1200 × 630 browser viewport at 100% zoom to screenshot the
whole card. The page displays the actual generated PNG. Save the PNG directly to
keep its full 2400 × 1260 resolution, independent of screenshot device scale or
browser zoom. No manual screenshot is required when sharing
links: the home page and `/s/{slug}` pages already include Open Graph and X/Twitter
large-image metadata pointing to the same `/og/image` PNG with its native dimensions.

Every community uses this one approved image. Community pages still read the
current public name and description from the database for their text metadata,
including administrator-approved communities added after the initial catalog was
seeded. Missing or archived communities inherit the site metadata. The image
endpoint requires no login or database access. Member, post, and event data remain
behind the existing application authentication.

`src/lib/community-banner.ts` supplies the actual banner and image renderer with
the same color palette, normalized name, and uppercase letters:

- Two or more words: first letter of the first two words (`Star Wars` → `SW`,
  `Build in Public` → `BI`).
- One word longer than four characters: first letter (`Anthropic` → `A`).
- One word of one to four characters: the whole word (`a16z` → `A16Z`).

Edit `src/components/social-image.tsx` to change the scene. Fonts and the Reddix
logo are loaded locally by `src/server/social-image.tsx`. The two Geist TTFs in
`src/assets/fonts` are bundled explicitly for the image route so production does
not depend on package-manager symlink paths. Their license is included alongside
them. The main card uses the
homepage's SF photograph with a dark gradient for readable white text. Its WebP
asset is converted losslessly to PNG for the image renderer. Development images are
not cached. Production images have a five-minute cache lifetime with up to one
hour of stale-while-revalidate; social platforms can maintain their own caches.
Community names and descriptions used in text metadata remain complete.

Set `APP_URL` to the canonical deployed origin (currently `https://reddix.co`).
Metadata falls back to `BETTER_AUTH_URL`, then Vercel deployment URLs, then local
development. Localhost previews show `reddix.co` in the artwork so screenshots
are usable; their metadata still points to the local server.
