# Reddix interface research and design direction

Research date: September 27, 2026. Target: a readable community product for people in tech, informed by product design published by mid-2026 and current official design-system guidance.

## What the evidence supports

The strongest relevant 2026 signal is refinement of mature product interfaces: clearer hierarchy, consistent controls, quieter navigation, and fewer competing visual elements. Linear documented those changes in its March 12, 2026 refresh. This is evidence about one well-established product, not proof of a universal visual trend. [Linear release announcement](https://linear.app/changelog/2026-03-12-ui-refresh).

Reddix should combine that restraint with the familiar reading order in the user's Reddit reference: community and timestamp, headline, content, then actions. A discussion feed needs room for actual contributions. Large decorative headings, repeated explanations, colorful controls, and ornamental illustrations consume that room without helping a person read or participate.

The recommendations below distinguish facts from design decisions. Exact spacing, sizes, colors, and limits are Reddix choices to validate in the working interface. They are not presented as measurements of another product.

## Evidence register

| Reference                                                                                                                                                                       | Date and scope                                                      | What it informs                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Linear: UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh)                                                                                                        | Published March 12, 2026                                            | Consistent headers and view controls; less prominent navigation; icon refinement.                                                    |
| [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh)                                                                   | Published March 12, 2026                                            | Fewer icons and separators, restrained surfaces, warmer neutral palette, deliberate attention hierarchy.                             |
| [Vercel Geist: colors](https://vercel.com/geist/colors)                                                                                                                         | Living official documentation; publication date not asserted        | Separate roles for backgrounds, borders, states, primary text, and secondary text.                                                   |
| [Vercel Geist: typography](https://vercel.com/geist/typography)                                                                                                                 | Living official documentation; publication date not asserted        | Different roles for headings, labels, buttons, and multiline copy.                                                                   |
| User-supplied Reddit screenshot                                                                                                                                                 | Captured September 27, 2026, supplied directly in this conversation | Feed card anatomy and reading rhythm. It is a visual reference, not evidence of a release date or the behavior of every Reddit view. |
| [Luma: searching for events](https://help.luma.com/p/searching-for-events)                                                                                                      | Living official documentation; publication date not asserted        | City/category discovery and distinct treatment of direct links and private events.                                                   |
| [Luma: event themes and customization](https://help.luma.com/p/event-themes-and-customization)                                                                                  | Living official documentation; publication date not asserted        | Event personality can coexist with a consistent, readable interface.                                                                 |
| [Partiful: creating your first event](https://help.partiful.com/en-us/articles/15525299-creating-your-first-partiful-event)                                                     | Published June 16, 2026                                             | Poster, title, date, location, description, then settings and sharing.                                                               |
| [W3C: text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | WCAG 2.2 guidance; an accessibility baseline, not a 2026 fashion    | Measurable readability and interaction requirements.                                                                                 |

## Eight design decisions

### 1. Make the feed the main visual object

**Evidence.** Linear's March refresh makes its headers and navigation more consistent and lowers the prominence of its sidebars so that work remains central. [Release announcement](https://linear.app/changelog/2026-03-12-ui-refresh).

**Reddix decision.** Use a compact global header for the logo, search, create action, notifications, and account menu. Keep the feed toolbar short. Put the current community identity near its content, then begin the feed quickly. Avoid a marketing-style welcome hero inside the logged-in product. Show supporting community and event information in a narrow secondary column, with fewer items than the main feed.

**Acceptance.** On a normal desktop viewport, the initial screen shows a substantial first post without scrolling past decorative introductory material. The header and sidebar cannot be mistaken for additional content cards. Popular, Following, and New use the same toolbar conventions.

### 2. Give posts a predictable reading order

**Evidence.** The supplied Reddit screenshot groups a post into a single rounded surface. Metadata is compact, the title and image dominate, and vote/comment/share controls sit together underneath. This is a direct observation of the user's visual reference.

**Reddix decision.** Treat a post as one readable unit with four parts: a compact identity row, a prominent title, the content or preview, and a compact action row. Put voting beside the other actions instead of leaving a permanent vertical rail to the left of every story. Use one content surface with gentle separation. Keep secondary actions such as report and save accessible through the overflow menu where appropriate.

**Acceptance.** Text posts, link posts, and image posts share the same identity and action structure. Long titles wrap without clipping. Images stay inside the card and preserve their meaning; they do not get arbitrarily cropped into decorative thumbnails. A long text preview is visibly limited, while opening the post exposes its complete content. Buttons remain independently operable and do not accidentally open the post.

### 3. Make navigation retractable and persistent

**Evidence.** Linear's March 2026 refresh treats navigation as supporting infrastructure and gives it less visual weight. Its release also discusses its collapsed-sidebar interaction, demonstrating that reduced navigation is part of the product rather than a separate mobile-only concern. [Release announcement](https://linear.app/changelog/2026-03-12-ui-refresh).

**Reddix decision.** Provide a clearly labeled toggle in the header. Desktop users can collapse the left sidebar and keep that preference after navigation and reload. Restoring it must be obvious. On small screens, navigation becomes a dismissible drawer instead of squeezing the content. Collapsing the sidebar should produce more breathing room, while a maximum reading width prevents excessively long lines.

**Acceptance.** Toggle labels and `aria-expanded` match the actual state. The state survives reload. Keyboard users can toggle it, move to its links, and dismiss the mobile drawer with Escape. Hidden navigation does not leave focusable controls offscreen. Feed width remains comfortable on large monitors.

### 4. Use color as identity and feedback

**Evidence.** Linear's design account describes reducing colored icon backgrounds, simplifying separators, and moving from a cool palette toward less saturated warm grays. Geist assigns separate color roles to surfaces, borders, strong fills, and text. [Linear design account](https://linear.app/now/behind-the-latest-design-refresh); [Geist colors](https://vercel.com/geist/colors).

**Reddix decision.** Build the page from quiet warm-neutral surfaces with a limited accent for active navigation, primary actions, links, and selected votes. Use the supplied logo as the principal brand asset. Let profile images, post media, and event posters contribute most of the other color. Keep blue and business verification distinctions legible without turning every label into a badge.

**Acceptance.** Every accent has a purpose. Inactive interface icons do not each receive their own colorful tile. Hover, selected, disabled, and focus states remain distinct. Both themes maintain readable metadata. A successful vote and a disabled vote can be understood without relying only on hue.

### 5. Separate readable text from quiet chrome

**Evidence.** Geist separates multiline copy from labels and buttons instead of using one text style everywhere. W3C requires a contrast ratio of at least 4.5:1 for ordinary text, with a 3:1 exception for qualifying large text. [Geist typography](https://vercel.com/geist/typography); [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Reddix decision.** Use a coherent sans-serif family, a small type scale, and regular/medium/semibold weights. Start feed copy around 15 to 16 px, headlines around 20 px, and compact metadata around 12 to 13 px, then inspect actual wrapping. Keep body copy and comments well above the minimum contrast target. Reduce noise by removing redundant text rather than making it unreadably faint. Reserve all-caps labels for rare organizational needs.

**Acceptance.** A person can distinguish title, body, and metadata by size and spacing without needing extreme contrast differences. Text retains contrast in normal and hover states. Full post bodies and comments have comfortable line height. Increasing browser zoom to 200% does not lose actions or content.

### 6. Reduce controls without hiding capabilities

**Evidence.** Linear's design account describes reducing icon quantity and size, compacting tabs, and softening unnecessary separators. The objective is to retain useful information while reducing competition between elements. [Linear design account](https://linear.app/now/behind-the-latest-design-refresh).

**Reddix decision.** Use icons for recognizable actions, usually beside a short label. Remove redundant icons next to obvious headings and repetitive help text. Keep a small set of visible actions and put occasional actions in a consistent menu. Use shared control sizes and alignment across feeds, community pages, profiles, settings, and events. Keep enough explanatory text for genuinely consequential states such as browse-only eligibility or private event attendance.

**Acceptance.** No action is represented only by an ambiguous unlabelled glyph. Icon-only controls have accessible names. Important status changes get concise feedback. Keyboard focus is visible. Pointer targets meet the 24-by-24 CSS pixel minimum or a documented spacing exception; primary mobile controls should aim for approximately 44 px. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

### 7. Give events personality inside a consistent frame

**Evidence.** Luma's discovery documentation organizes browsing around cities and categories. Its theme documentation describes adapting chosen colors for readability. Partiful's June 2026 creation guide centers a poster and essential event details before additional settings. [Luma discovery](https://help.luma.com/p/searching-for-events); [Luma themes](https://help.luma.com/p/event-themes-and-customization); [Partiful creation guide](https://help.partiful.com/en-us/articles/15525299-creating-your-first-partiful-event).

**Reddix decision.** Let event imagery and concise titles establish character. Keep date/time, city or venue, and RSVP status immediately visible. Reuse the site's controls, text scale, and navigation. Make native registration versus an external RSVP destination explicit. Put host management controls in their own section rather than mixing them into guest reading order. Avoid filling every empty area with unrelated gradients, orbits, or generated geometric artwork.

**Acceptance.** A guest can identify what, when, where, and how to join before opening secondary controls. Discovery filters preserve city/date context. Private venue and attendee information remain subject to the existing permission rules. New styling does not change who can discover an event or access it through a direct link.

### 8. Let the supplied brand asset replace decorative compensation

**Evidence.** The user explicitly supplied a logo and asked for a more deliberate identity. The Reddit image demonstrates that recognizable identity and strong content can carry an interface without an elaborate decorative system.

**Reddix decision.** Use the supplied asset intact wherever practical, at a size that reads in the header and login screen. Give it deliberate clear space. Avoid layering an unrelated generated mark, extra tagline, and oversized wordmark around it. Check contrast and crop at real display sizes. The logo, community content, and consistent interaction details should make the product recognizable.

**Acceptance.** The asset looks intentional in both themes and at narrow widths, does not stretch, and has a useful accessible name when it is the home link. It remains visible when navigation is collapsed. Asset files are local and do not depend on a third-party image request.

## Validation protocol

The decisions above are a design direction, not evidence that the implementation already meets them. Verify the finished interface using real browser screenshots and interactions.

1. Inspect Popular, a city community, a text discussion, a profile, event discovery, an event detail, settings, and login in the same visual system.
2. Inspect desktop at approximately 1440 px, a narrower laptop width, and mobile around 390 px in both light and dark modes. Check long titles, empty states, missing avatars, and loading/error states.
3. Collapse and restore the sidebar, navigate, reload, and repeat with keyboard controls. Confirm that scroll position and content context remain stable.
4. Inspect normal, hovered, focused, selected, and disabled controls. Verify contrast from computed colors rather than judging only screenshots.
5. Exercise posting, voting, comments, saves, reporting, profile navigation, and event registration after markup changes. Existing authorization and privacy behavior must remain intact.
6. Check for page overflow, clipped menus, crowded action rows, hidden focus, stretched media, and logo distortion. Respect reduced-motion preferences.

## Boundaries

This research does not establish that every tech user prefers one palette, font, or density. It also does not make a case for copying another product's branding or importing every fashionable effect. The user has identified the useful outcome: a familiar, readable feed with clear identity and controllable navigation. That outcome is the standard for the redesign.
