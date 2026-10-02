# Reputation

Members earn reputation from votes on their published posts and comments:

- Each upvote from another member adds 1 point. Each downvote subtracts 1 point.
- A member's own votes, including the automatic upvote when publishing, add no reputation.
- Removing or changing a vote updates its contribution. Switching an upvote to a downvote changes the underlying vote total by -2.
- Post and comment reputation are tracked separately, each with a minimum of 0. Total reputation is their sum, so it can never be negative. Underlying votes are preserved: a negative vote total must recover above 0 before that category earns reputation again.
- Deleted or removed content contributes no reputation. Comments also require a published parent post. Restoring content includes its current votes again.

Reputation is calculated from all existing votes at read time, independent of feed or profile pagination. Existing votes count immediately; no backfill, stored counters, or migration is required.

Bootstrap returns the current member's `reputation`, and the member profile API returns the viewed member's `reputation`. Both use `{ posts, comments, total }`. Members who have not completed onboarding receive zero reputation in bootstrap.
