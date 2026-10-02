import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Bootstrap, Comment, Post, Reputation } from "../../src/lib/types";

async function login(
  context: BrowserContext,
  baseURL: string,
  persona: "alex" | "morgan",
) {
  expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL).hostname);
  const response = await context.request.post("/api/auth/dev-login", {
    headers: { Origin: new URL(baseURL).origin },
    data: { persona },
  });
  expect(response.status()).toBe(200);
}

async function bootstrap(context: BrowserContext): Promise<Bootstrap> {
  const response = await context.request.get("/api/bootstrap");
  expect(response.ok()).toBe(true);
  return response.json();
}

async function action<T = unknown>(
  context: BrowserContext,
  baseURL: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await context.request.post("/api/actions", {
    headers: { Origin: new URL(baseURL).origin },
    data,
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

async function vote(page: Page, click: () => Promise<unknown>) {
  const pending = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/actions")) return false;
    return response.request().postDataJSON()?.action === "vote";
  });
  await click();
  const response = await pending;
  expect(response.ok(), JSON.stringify(await response.json())).toBe(true);
}

function withVotes(
  baseline: Reputation,
  posts: number,
  comments: number,
): Reputation {
  const postReputation = Math.max(0, baseline.posts + posts);
  const commentReputation = Math.max(0, baseline.comments + comments);
  return {
    posts: postReputation,
    comments: commentReputation,
    total: postReputation + commentReputation,
  };
}

async function expectProfile(page: Page, reputation: Reputation) {
  const summary = page.getByRole("group", { name: "Reputation", exact: true });
  await expect(summary).toBeVisible();
  for (const [label, value] of [
    ["Reputation", reputation.total],
    ["Post reputation", reputation.posts],
    ["Comment reputation", reputation.comments],
  ] as const) {
    const stat = summary
      .locator(".reputation-stats > div")
      .filter({ has: page.getByText(label, { exact: true }) });
    await expect(stat.locator("dd")).toHaveText(value.toLocaleString("en-US"));
  }
}

async function expectSidebar(page: Page, total: number) {
  await expect(
    page.locator(".sidebar-account .sidebar-reputation"),
  ).toHaveAttribute("title", `${total.toLocaleString("en-US")} reputation`);
}

test("votes earn persistent post and comment reputation, and undoing votes adjusts it", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await login(context, baseURL!, "alex");
  const author = await bootstrap(context);
  const baseline = author.reputation;
  const voterContext = await browser.newContext({ baseURL });
  let postId: string | undefined;
  let commentId: string | undefined;

  try {
    await login(voterContext, baseURL!, "morgan");
    const voter = await bootstrap(voterContext);
    const voterPage = await voterContext.newPage();
    const title = `browser-reputation-${randomUUID()}`;
    const commentBody = "A temporary reply to check earned comment reputation.";
    const community = author.communities.find((item) => item.slug === "sf")!;
    const created = await action<{ post: Post }>(context, baseURL!, {
      action: "createPost",
      communityId: community.id,
      title,
      body: "A temporary discussion to check reputation from another member's votes.",
    });
    postId = created.post.id;
    expect(created.post.myVote).toBe(1);
    const reply = await action<{ commentId: string }>(context, baseURL!, {
      action: "comment",
      postId,
      body: commentBody,
    });
    commentId = reply.commentId;
    const discussionResponse = await context.request.get(
      `/api/posts/${postId}`,
    );
    expect(discussionResponse.ok()).toBe(true);
    const discussion: { comments: Comment[] } = await discussionResponse.json();
    expect(
      discussion.comments.find((comment) => comment.id === commentId)?.myVote,
    ).toBe(1);

    // The automatic votes on your own contributions do not earn reputation.
    expect((await bootstrap(context)).reputation).toEqual(baseline);
    await page.goto(`/u/${author.member.id}`);
    await expectProfile(page, baseline);
    await expectSidebar(page, baseline.total);

    // Voting on a member's profile must refresh its summary without a reload.
    await voterPage.goto(`/u/${author.member.id}`);
    const profilePost = voterPage.locator(".post-card").filter({
      has: voterPage.getByRole("heading", { name: title, exact: true }),
    });
    await vote(voterPage, () =>
      profilePost.getByRole("button", { name: "Upvote", exact: true }).click(),
    );
    await expectProfile(voterPage, withVotes(baseline, 1, 0));
    await expectSidebar(voterPage, voter.reputation.total);

    await voterPage.goto(`/p/${postId}`);
    const post = voterPage.locator(".post-card-detail");
    const comment = voterPage.locator(".comment-list > .comment").filter({
      has: voterPage.getByText(commentBody, { exact: true }),
    });
    await vote(voterPage, () =>
      comment.getByRole("button", { name: "Upvote", exact: true }).click(),
    );
    await expect(
      comment.getByRole("button", { name: "Upvote", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await voterPage.reload();
    for (const contribution of [post, comment]) {
      await expect(
        contribution.getByRole("button", { name: "Upvote", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }

    const earned = withVotes(baseline, 1, 1);
    await page.reload();
    await expectProfile(page, earned);
    await expectSidebar(page, earned.total);
    expect((await bootstrap(context)).reputation).toEqual(earned);
    const profileResponse = await voterContext.request.get(
      `/api/members/${author.member.id}`,
    );
    expect(profileResponse.ok()).toBe(true);
    expect((await profileResponse.json()).reputation).toEqual(earned);

    await voterPage.goto(`/u/${author.member.id}`);
    await vote(voterPage, () =>
      profilePost.getByRole("button", { name: "Upvote", exact: true }).click(),
    );
    await expectProfile(voterPage, withVotes(baseline, 0, 1));

    // Downvotes reduce comment reputation without taking it below zero.
    await voterPage.goto(`/p/${postId}`);
    await vote(voterPage, () =>
      comment.getByRole("button", { name: "Downvote", exact: true }).click(),
    );
    await voterPage.reload();
    await expect(
      comment.getByRole("button", { name: "Downvote", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      post.getByRole("button", { name: "Upvote", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    const downvoted = withVotes(baseline, 0, -1);
    await expectProfile(page, downvoted);
    await expectSidebar(page, downvoted.total);
    expect((await bootstrap(context)).reputation).toEqual(downvoted);

    await vote(voterPage, () =>
      comment.getByRole("button", { name: "Downvote", exact: true }).click(),
    );
    await page.reload();
    await expectProfile(page, baseline);
    await expectSidebar(page, baseline.total);
    expect((await bootstrap(context)).reputation).toEqual(baseline);

    await voterPage.setViewportSize({ width: 390, height: 844 });
    await voterPage.goto(`/u/${author.member.id}`);
    await expectProfile(voterPage, baseline);
    expect(
      await voterPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    try {
      for (const target of [
        ...(commentId ? [{ commentId }] : []),
        ...(postId ? [{ postId }] : []),
      ]) {
        for (const memberContext of [voterContext, context]) {
          await action(memberContext, baseURL!, {
            action: "vote",
            ...target,
            value: 0,
          });
        }
      }
      if (commentId)
        await action(context, baseURL!, { action: "deleteComment", commentId });
      if (postId)
        await action(context, baseURL!, { action: "deletePost", postId });
    } finally {
      await voterContext.close();
    }
  }
});
