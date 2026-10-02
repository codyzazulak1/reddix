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
import type {
  ModerationDecision,
  ModerationInput,
} from "../src/lib/moderation-types";
import { ensureAuthDatabase } from "../src/lib/auth-store";
import { deleteAccount, exportAccount } from "../src/lib/account-service";
import { sql } from "../src/server/db";
import { getMemberById } from "../src/server/members";
import { performAction } from "../src/server/actions";
import {
  enqueueModeration,
  processModerationQueue,
  reviewModerationDecision,
} from "../src/server/moderation";

// Every worker invocation is constrained to this run's own job IDs. It must
// never classify or change a real member's contribution in a shared local DB.
describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "persistent @reddix moderation",
  () => {
    const prefix = `moderation-test-${randomUUID()}`;
    const authorId = `${prefix}-author`,
      adminId = `${prefix}-admin`;
    const memberIds = [authorId, adminId];
    const postIds: string[] = [],
      commentIds: string[] = [],
      jobIds: string[] = [];
    let author: Member, admin: Member;
    let usageBefore: Record<string, unknown> | undefined;
    let usageDay: string;
    let erasedReservations = 0;

    function decision(
      overrides: Partial<ModerationDecision> = {},
    ): ModerationDecision {
      return {
        verdict: "remove",
        category: "spam",
        confidence: 0.99,
        reason: "Repeated promotional messages violate the community rules.",
        model: "fixture/moderator",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        ...overrides,
      };
    }

    async function post(label: string) {
      const id = `${prefix}-${label}`;
      postIds.push(id);
      await sql`INSERT INTO posts(id,community_id,author_id,title,body,type)
      VALUES(${id},'sf',${authorId},${`Fixture: ${label}`},'Synthetic moderation test content.','text')`;
      const jobId = await sql.begin((tx) =>
        enqueueModeration(tx, "post", id, "create"),
      );
      expect(jobId).toBeTruthy();
      jobIds.push(jobId!);
      return { id, jobId: jobId! };
    }

    async function storedJob(id: string) {
      const [row] = await sql`SELECT * FROM moderation_jobs WHERE id=${id}`;
      return row;
    }
    async function storedDecision(id: string) {
      const [row] =
        await sql`SELECT * FROM moderation_decisions WHERE job_id=${id}`;
      return row;
    }
    async function postStatus(id: string) {
      const [row] =
        await sql`SELECT status,body,moderation_decision_id FROM posts WHERE id=${id}`;
      return row;
    }

    beforeAll(async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("AUTH_MODE", "development");
      vi.stubEnv("AUTO_MIGRATE", "1");
      await ensureAuthDatabase();
      for (const id of [authorId, adminId])
        await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_expires_at,is_admin,admitted_at,onboarding_completed_at)
        VALUES(${id},${id},'Moderation Fixture',${id},'blue',now()+interval '1 day',${id === adminId},now(),now())`;
      author = (await getMemberById(authorId))!;
      admin = (await getMemberById(adminId))!;
      const [day] =
        await sql`SELECT (now() AT TIME ZONE 'UTC')::date::text AS day`;
      usageDay = day.day;
      [usageBefore] =
        await sql`SELECT * FROM moderation_daily_usage WHERE day=${usageDay}`;
    }, 30000);

    beforeEach(() => {
      vi.stubEnv("OPENROUTER_API_KEY", "fixture-key-never-sent");
      vi.stubEnv("REDDIX_MODERATION_MODE", "auto");
      vi.stubEnv("REDDIX_MODERATION_DAILY_LIMIT", "100000");
    });

    afterAll(async () => {
      if (jobIds.length) {
        // Requests are reservations, including failed attempts. Remove only this
        // suite's reservations, preserving any unrelated concurrent accounting.
        const [used] =
          await sql`SELECT COALESCE(sum(attempts),0)::int AS requests FROM moderation_jobs WHERE id IN ${sql(jobIds)}`;
        const [charged] =
          await sql`SELECT COALESCE(sum(input_tokens),0) AS input_tokens,COALESCE(sum(output_tokens),0) AS output_tokens,COALESCE(sum(cost_usd),0) AS cost_usd FROM moderation_decisions WHERE job_id IN ${sql(jobIds)}`;
        await sql`UPDATE moderation_daily_usage SET requests=GREATEST(0,requests-${Number(used.requests) + erasedReservations}),input_tokens=GREATEST(0,input_tokens-${Number(charged.input_tokens)}),output_tokens=GREATEST(0,output_tokens-${Number(charged.output_tokens)}),cost_usd=GREATEST(0,cost_usd-${Number(charged.cost_usd)}) WHERE day=${usageDay}`;
        if (!usageBefore)
          await sql`DELETE FROM moderation_daily_usage WHERE day=${usageDay} AND requests=0 AND input_tokens=0 AND output_tokens=0 AND cost_usd=0`;
        await sql`DELETE FROM moderation_jobs WHERE id IN ${sql(jobIds)}`;
      }
      await sql`DELETE FROM notifications WHERE user_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM audit_events WHERE actor_id IN ${sql(memberIds)} OR target_id LIKE ${`${prefix}%`}`;
      await sql`DELETE FROM reports WHERE reporter_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM rate_limits WHERE key LIKE ${`action:${prefix}%`}`;
      await sql`DELETE FROM comment_votes WHERE user_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM post_votes WHERE user_id IN ${sql(memberIds)}`;
      if (commentIds.length)
        await sql`DELETE FROM comments WHERE id IN ${sql(commentIds)}`;
      if (postIds.length)
        await sql`DELETE FROM posts WHERE id IN ${sql(postIds)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(memberIds)}`;
      vi.unstubAllEnvs();
    });

    it("keeps queued content visible and never calls a provider before an API key exists", async () => {
      const target = await post("no-key");
      vi.stubEnv("OPENROUTER_API_KEY", "");
      const classify = vi.fn(async () => decision());
      await processModerationQueue({ jobIds: [target.jobId], classify });
      expect(classify).not.toHaveBeenCalled();
      expect((await storedJob(target.jobId)).state).toBe("queued");
      expect((await storedJob(target.jobId)).attempts).toBe(0);
      expect((await postStatus(target.id)).status).toBe("published");
      expect(await storedDecision(target.jobId)).toBeUndefined();
      vi.stubEnv("OPENROUTER_API_KEY", "fixture-key-never-sent");
      vi.stubEnv("REDDIX_MODERATION_MODE", "off");
      await processModerationQueue({ jobIds: [target.jobId], classify });
      expect(classify).not.toHaveBeenCalled();
      expect((await storedJob(target.jobId)).attempts).toBe(0);
    });

    it("queues actual post, comment, edit, and report actions without blocking publication", async () => {
      const created = await performAction(author, {
        action: "createPost",
        communityId: "sf",
        type: "text",
        title: "A fixture discussion about developer tools",
        body: "A legitimate technical question.",
      });
      const postId = (created.post as Post).id;
      postIds.push(postId);
      const reply = await performAction(author, {
        action: "comment",
        postId,
        body: "An initial technical reply.",
      });
      const commentId = String(reply.commentId);
      commentIds.push(commentId);
      try {
        const original =
          await sql`SELECT * FROM moderation_jobs WHERE target_id IN (${postId},${commentId})`;
        expect(original).toHaveLength(2);
        expect(
          original.every(
            (row) => row.source === "create" && row.state === "queued",
          ),
        ).toBe(true);
        await performAction(author, {
          action: "editComment",
          commentId,
          body: "A corrected technical reply.",
        });
        await performAction(admin, {
          action: "report",
          targetType: "comment",
          targetId: commentId,
          reason: "Please review this fixture.",
        });
        const revisions =
          await sql`SELECT * FROM moderation_jobs WHERE target_type='comment' AND target_id=${commentId}`;
        expect(revisions).toHaveLength(2);
        expect(revisions.find((row) => row.state === "queued")).toMatchObject({
          source: "edit",
          reported: true,
          attempts: 0,
        });
        expect(revisions.find((row) => row.source === "create")?.state).toBe(
          "superseded",
        );
        expect((await postStatus(postId)).status).toBe("published");
        const [comment] =
          await sql`SELECT status FROM comments WHERE id=${commentId}`;
        expect(comment.status).toBe("published");
      } finally {
        const jobs =
          await sql`SELECT id FROM moderation_jobs WHERE target_id IN (${postId},${commentId})`;
        jobIds.push(...jobs.map((row) => String(row.id)));
      }
    });

    it("deduplicates one content revision and records a reversible removal with an author notice and audit", async () => {
      const target = await post("remove");
      const [usage] =
        await sql`SELECT * FROM moderation_daily_usage WHERE day=${usageDay}`;
      const repeated = await sql.begin((tx) =>
        enqueueModeration(tx, "post", target.id, "report"),
      );
      expect(repeated).toBe(target.jobId);
      const classify = vi.fn(async (input: ModerationInput) => {
        expect(input).toMatchObject({
          targetType: "post",
          body: "Synthetic moderation test content.",
          reported: true,
        });
        expect(JSON.stringify(input)).not.toContain(authorId);
        return decision({
          inputTokens: 17,
          outputTokens: 3,
          costUsd: 0.000001,
        });
      });
      await processModerationQueue({ jobIds: [target.jobId], classify });
      await processModerationQueue({ jobIds: [target.jobId], classify });
      expect(classify).toHaveBeenCalledTimes(1);
      const saved = await storedDecision(target.jobId);
      expect(saved).toMatchObject({
        action: "remove",
        model: "fixture/moderator",
        resolution: "removed",
      });
      expect(await postStatus(target.id)).toMatchObject({
        status: "removed",
        moderation_decision_id: saved.id,
      });
      const notices =
        await sql`SELECT message FROM notifications WHERE user_id=${authorId} AND resource_id=${target.id}`;
      expect(notices).toHaveLength(1);
      expect(String(notices[0].message)).toMatch(/reddix/i);
      const audit =
        await sql`SELECT actor_id FROM audit_events WHERE target_id=${target.id}`;
      expect(audit.some((row) => row.actor_id === "system-reddix")).toBe(true);
      const [updated] =
        await sql`SELECT * FROM moderation_daily_usage WHERE day=${usageDay}`;
      expect(Number(updated.requests)).toBe(Number(usage?.requests ?? 0) + 1);
      expect(Number(updated.input_tokens)).toBe(
        Number(usage?.input_tokens ?? 0) + 17,
      );
      expect(Number(updated.output_tokens)).toBe(
        Number(usage?.output_tokens ?? 0) + 3,
      );
      expect(Number(updated.cost_usd)).toBeCloseTo(
        Number(usage?.cost_usd ?? 0) + 0.000001,
        8,
      );
    });

    it("leases each job to only one worker when queue runs overlap", async () => {
      const target = await post("concurrent");
      const classify = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return decision({ verdict: "allow", category: "none" });
      });
      await Promise.all([
        processModerationQueue({ jobIds: [target.jobId], classify }),
        processModerationQueue({ jobIds: [target.jobId], classify }),
      ]);
      expect(classify).toHaveBeenCalledTimes(1);
      expect((await storedJob(target.jobId)).attempts).toBe(1);
      expect((await storedDecision(target.jobId)).action).toBe("allow");
    });

    it("routes uncertain decisions and review mode to humans without hiding a post", async () => {
      const uncertain = await post("uncertain");
      await processModerationQueue({
        jobIds: [uncertain.jobId],
        classify: async () => decision({ confidence: 0.51 }),
      });
      expect((await postStatus(uncertain.id)).status).toBe("published");
      expect((await storedDecision(uncertain.jobId)).action).toBe("review");
      const reviewOnly = await post("review-mode");
      vi.stubEnv("REDDIX_MODERATION_MODE", "review");
      await processModerationQueue({
        jobIds: [reviewOnly.jobId],
        classify: async () => decision(),
      });
      expect((await postStatus(reviewOnly.id)).status).toBe("published");
      expect((await storedDecision(reviewOnly.jobId)).action).toBe("review");
    });

    it("does not apply a stale decision when the author edits during classification", async () => {
      const target = await post("stale");
      let newerJob: string | null = null;
      await processModerationQueue({
        jobIds: [target.jobId],
        classify: async () => {
          newerJob = await sql.begin(async (tx) => {
            await tx`UPDATE posts SET body='A corrected contribution with different text.',updated_at=now() WHERE id=${target.id}`;
            return enqueueModeration(tx, "post", target.id, "edit");
          });
          if (newerJob) jobIds.push(newerJob);
          return decision();
        },
      });
      expect(newerJob).not.toBe(target.jobId);
      expect(await postStatus(target.id)).toMatchObject({
        status: "published",
        body: "A corrected contribution with different text.",
      });
      expect((await storedJob(target.jobId)).state).toBe("superseded");
      expect((await storedJob(newerJob!)).state).toBe("queued");
    });

    it("requires an admin for review and never reverses a manual restoration on the same revision", async () => {
      const target = await post("restore");
      await processModerationQueue({
        jobIds: [target.jobId],
        classify: async () => decision(),
      });
      const saved = await storedDecision(target.jobId);
      const review = {
        decisionId: String(saved.id),
        resolution: "restore" as const,
        reason: "Context shows this was a legitimate discussion.",
      };
      await expect(
        reviewModerationDecision(author, review),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await sql`UPDATE users SET verification_expires_at=now()-interval '1 hour' WHERE id=${authorId}`;
      try {
        await reviewModerationDecision(admin, review);
        expect((await postStatus(target.id)).status).toBe("published");
        expect((await storedDecision(target.jobId)).resolution).toBe(
          "restored",
        );
        await sql.begin((tx) =>
          enqueueModeration(tx, "post", target.id, "report"),
        );
        const classify = vi.fn(async () => decision());
        await processModerationQueue({ jobIds: [target.jobId], classify });
        expect(classify).not.toHaveBeenCalled();
        expect((await postStatus(target.id)).status).toBe("published");
      } finally {
        await sql`UPDATE users SET verification_expires_at=now()+interval '1 day' WHERE id=${authorId}`;
      }
    });

    it("moderates a comment with discussion context while leaving the parent post intact", async () => {
      const parent = await post("comment-parent");
      const commentId = `${prefix}-comment`;
      commentIds.push(commentId);
      await sql`INSERT INTO comments(id,post_id,author_id,body,depth) VALUES(${commentId},${parent.id},${authorId},'Synthetic comment for moderation.',0)`;
      const jobId = await sql.begin((tx) =>
        enqueueModeration(tx, "comment", commentId, "create"),
      );
      jobIds.push(jobId!);
      const classify = vi.fn(async (input: ModerationInput) => {
        expect(input.targetType).toBe("comment");
        expect(input.context.some((item) => item.role === "post")).toBe(true);
        return decision();
      });
      await processModerationQueue({ jobIds: [jobId!], classify });
      const [comment] =
        await sql`SELECT status FROM comments WHERE id=${commentId}`;
      expect(comment.status).toBe("removed");
      expect((await postStatus(parent.id)).status).toBe("published");
      expect((await storedJob(parent.jobId)).attempts).toBe(0);
    });

    it("backs off after provider failures and retries without duplicate decisions or notices", async () => {
      const target = await post("retry");
      const failed = vi.fn(async (): Promise<ModerationDecision> => {
        throw new Error("Synthetic provider outage");
      });
      await processModerationQueue({
        jobIds: [target.jobId],
        classify: failed,
      });
      expect((await postStatus(target.id)).status).toBe("published");
      expect(await storedDecision(target.jobId)).toBeUndefined();
      await processModerationQueue({
        jobIds: [target.jobId],
        classify: failed,
      });
      expect(failed).toHaveBeenCalledTimes(1);
      await sql`UPDATE moderation_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=${target.jobId}`;
      await processModerationQueue({
        jobIds: [target.jobId],
        classify: async () => decision({ verdict: "allow", category: "none" }),
      });
      expect((await storedJob(target.jobId)).state).toBe("complete");
      expect((await storedJob(target.jobId)).attempts).toBe(2);
      expect((await storedDecision(target.jobId)).action).toBe("allow");
    });

    it("stops at the daily request cap and leaves remaining work queued", async () => {
      const first = await post("quota-first"),
        second = await post("quota-second");
      const [usage] =
        await sql`SELECT requests FROM moderation_daily_usage WHERE day=${usageDay}`;
      vi.stubEnv(
        "REDDIX_MODERATION_DAILY_LIMIT",
        String(Number(usage?.requests ?? 0) + 1),
      );
      const classify = vi.fn(async () =>
        decision({ verdict: "allow", category: "none" }),
      );
      await processModerationQueue({
        limit: 2,
        jobIds: [first.jobId, second.jobId],
        classify,
      });
      expect(classify).toHaveBeenCalledTimes(1);
      const jobs =
        await sql`SELECT state FROM moderation_jobs WHERE id IN (${first.jobId},${second.jobId})`;
      expect(jobs.map((row) => row.state).sort()).toEqual([
        "complete",
        "queued",
      ]);
    });

    it.each([false, true])(
      "exports only own moderation and erases decisions during an in-flight check (deleteContent=%s)",
      async (deleteContent) => {
        const id = `${prefix}-privacy-${deleteContent}`;
        memberIds.push(id);
        await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_expires_at,admitted_at,onboarding_completed_at)
        VALUES(${id},${id},'Privacy Fixture',${id},'blue',now()+interval '1 day',now(),now())`;
        const member = (await getMemberById(id))!;
        const postId = `${id}-post`,
          commentId = `${id}-comment`;
        postIds.push(postId);
        commentIds.push(commentId);
        await sql`INSERT INTO posts(id,community_id,author_id,title,body,type) VALUES(${postId},'sf',${id},'Privacy fixture','Public content retention choice.','text')`;
        await sql`INSERT INTO comments(id,post_id,author_id,body,depth) VALUES(${commentId},${postId},${id},'Another fixture contribution.',0)`;
        const firstJob = await sql.begin((tx) =>
          enqueueModeration(tx, "post", postId, "create"),
        );
        const pendingJob = await sql.begin((tx) =>
          enqueueModeration(tx, "comment", commentId, "create"),
        );
        jobIds.push(firstJob!, pendingJob!);
        await processModerationQueue({
          jobIds: [firstJob!],
          classify: async () =>
            decision({
              verdict: "review",
              reason: "Private fixture moderation rationale.",
            }),
        });
        const exported = await exportAccount(member);
        expect(exported.moderation).toHaveLength(1);
        expect(exported.moderation[0]).toMatchObject({
          target_id: postId,
          reason: "Private fixture moderation rationale.",
        });
        expect(JSON.stringify(exported.moderation)).not.toContain(
          `${prefix}-remove`,
        );
        await processModerationQueue({
          jobIds: [pendingJob!],
          classify: async () => {
            const [used] =
              await sql`SELECT sum(attempts)::int AS requests FROM moderation_jobs WHERE id IN (${firstJob!},${pendingJob!})`;
            await deleteAccount(member, {
              confirmation: member.handle,
              deleteContent,
            });
            erasedReservations += Number(used.requests);
            return decision({
              reason:
                "This delayed response must not recreate erased personal data.",
            });
          },
        });
        const records =
          await sql`SELECT id FROM moderation_decisions WHERE author_id=${id}`;
        const jobs =
          await sql`SELECT id FROM moderation_jobs WHERE target_id IN (${postId},${commentId})`;
        expect(records).toHaveLength(0);
        expect(jobs).toHaveLength(0);
        const retained = await postStatus(postId);
        expect(retained.status).toBe(deleteContent ? "deleted" : "published");
        expect(retained.body).toBe(
          deleteContent ? "" : "Public content retention choice.",
        );
      },
    );
  },
);
