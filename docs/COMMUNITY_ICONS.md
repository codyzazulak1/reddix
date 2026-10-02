# Community identities

The 57 seeded communities have a shared visual identity registry in `src/lib/community-identities.ts`. Company and product communities use locally bundled brand marks. Cities, events, and discussion topics use the existing Lucide icon family, a custom San Francisco bridge, and curated background colors.

`CommunityIcon` in `src/components/community-icon.tsx` takes the community's stable slug, name, and legacy icon key. Every community surface uses it: navigation, community headers, feed cards, the directory, search results, and recommendations. No database migration or member action is needed to apply these identities to existing communities.

Brand assets live in `public/community-logos/`. The grouped manifests specify the local source and tile colors. `fullBleed` is used for favicon images that already contain their background and padding; other marks retain breathing room and preserve their aspect ratio. Failed images fall back to the community's topic icon. Future uncatalogued communities can use their existing icon key or name initials.

Assets are served by Reddix without runtime requests to logo aggregators or company websites. The logo is decorative beside the visible community name, so screen readers do not repeat the name. The surrounding community button or link remains the accessible navigation target.

Source records:

- [AI and model communities](community-assets-ai.md)
- [Developer tools](community-assets-tools.md)
- [Founders, capital, and frontier technology](community-assets-frontier.md)

Brand marks identify discussion subjects, not ownership or endorsement. Individual brand rights remain with their respective owners; the source records document applicable licenses and any use of a parent company mark for a product community.
