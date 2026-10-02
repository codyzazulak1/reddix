import { randomUUID } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "../src/server/db";
import {
  ensureAuthDatabase,
  completeAdmission,
  createAuthenticationAttempt,
  recordAttemptProfile,
} from "../src/lib/auth-store";
import { getMemberById } from "../src/server/members";
import { performAction } from "../src/server/actions";
import { getCommunities, getComments, getPosts } from "../src/server/queries";
import {
  buildDigest,
  dispatchOutbox,
  enqueuePostPromotion,
  recordMemberVisit,
  reserveBotUsage,
  runXGrowthJobs,
  syncOrganizationAffiliates,
  renderOutbox,
  retirePendingInvitations,
} from "../src/server/x-growth";
import { parseXProfile } from "../src/lib/auth-x";
import { GET as adminGet } from "../src/app/api/admin/x-bot/route";
import { GET as cronGet } from "../src/app/api/jobs/x/route";
vi.mock("../src/server/x-bot-auth", () => ({
  botAccessToken: async () => "test-bot-token",
}));
const enabled = process.env.RUN_DB_TESTS === "1";
const prefix = `x-growth-test-${randomUUID()}`;
const numeric = `9${Date.now()}`;
const community = `${prefix}-community`,
  author = `${prefix}-author`;
const handles = ["requester", "affiliate", "impostor"];
const fetchMock = vi.fn();
const userIds: string[] = [author];
async function createPost(promoteOnX = true) {
  const member = (await getMemberById(author))!;
  const result = await performAction(member, {
    action: "createPost",
    communityId: community,
    title: "A useful compiler discussion",
    body: "An original technical discussion",
    promoteOnX,
  });
  const post = result.post as { id: string };
  return post.id;
}
async function attempt(xId: string, index: number) {
  const authId = `${prefix}-auth-${index}`;
  await sql`INSERT INTO auth_user(id,name,email) VALUES(${authId},'Test',${`${authId}@test.invalid`})`;
  await sql`INSERT INTO auth_account(id,account_id,provider_id,user_id) VALUES(${authId},${xId},'twitter',${authId})`;
  const attempt = await createAuthenticationAttempt(null);
  await recordAttemptProfile(
    attempt.id,
    parseXProfile({
      id: xId,
      name: "Test",
      username: handles[index % 3],
      description: "technology interest",
      verified_type: "blue",
    }),
  );
  return { ...attempt, authId };
}
describe.skipIf(!enabled)("X growth integration", () => {
  beforeAll(async () => {
    await ensureAuthDatabase();
    await sql`INSERT INTO communities(id,slug,name,description) VALUES(${community},${community},'Growth test','Test community')`;
    await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_expires_at,admitted_at,onboarding_completed_at) VALUES(${author},${`${numeric}0`},'Test Author','testauthor','blue',now()+interval '1 day',now(),now())`;
  });
  beforeEach(async () => {
    vi.stubEnv("X_BOT_MODE", "live");
    vi.stubEnv("X_BOT_CLIENT_ID", "test-client");
    vi.stubEnv("X_BOT_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("X_BOT_USER_ID", "999999");
    vi.stubEnv("X_BOT_AUTOMATION_APPROVED", "1");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-".repeat(6));
    vi.stubEnv("APP_URL", "https://reddix.test");
    vi.stubEnv("X_BOT_TIMEZONE", "America/Los_Angeles");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await sql`UPDATE x_outbox SET state='canceled' WHERE resource_id IN (SELECT id FROM posts WHERE author_id=${author}) OR resource_id LIKE ${prefix + "%"}`;
    await sql`UPDATE users SET preferences='{}'::jsonb WHERE id=${author}`;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await sql`DELETE FROM x_outbox WHERE resource_id IN (SELECT id FROM posts WHERE author_id=${author}) OR resource_id LIKE ${prefix + "%"}`;
    await sql`DELETE FROM x_invite_requests WHERE id LIKE ${prefix + "%"}`;
    await sql`DELETE FROM x_contact_preferences WHERE x_id LIKE ${numeric + "%"}`;
    await sql`DELETE FROM auth_admission_passes WHERE member_id IN ${sql(userIds)}`;
    await sql`DELETE FROM auth_admission_attempts WHERE completed_member_id IN ${sql(userIds)} OR expected_x_id LIKE ${numeric + "%"} OR profile->>'xId' LIKE ${numeric + "%"}`;
    await sql`DELETE FROM enrollment_invites WHERE intended_x_id LIKE ${numeric + "%"}`;
    await sql`DELETE FROM auth_audit WHERE member_id IN ${sql(userIds)}`;
    await sql`DELETE FROM auth_user WHERE id LIKE ${prefix + "%"}`;
    await sql`DELETE FROM member_activity WHERE member_id IN ${sql(userIds)}`;
    await sql`DELETE FROM member_visit_sessions WHERE member_id IN ${sql(userIds)}`;
    await sql`DELETE FROM moderation_jobs WHERE target_id IN (SELECT id FROM posts WHERE author_id=${author})`;
    await sql`DELETE FROM notifications WHERE user_id IN ${sql(userIds)}`;
    await sql`DELETE FROM comments WHERE author_id=${author}`;
    await sql`DELETE FROM post_votes WHERE user_id=${author}`;
    await sql`DELETE FROM posts WHERE author_id=${author}`;
    await sql`DELETE FROM community_memberships WHERE community_id=${community}`;
    await sql`DELETE FROM community_x_affiliations WHERE community_id=${community}`;
    await sql`DELETE FROM community_x_accounts WHERE community_id=${community}`;
    await sql`DELETE FROM communities WHERE id=${community}`;
    await sql`DELETE FROM rate_limits WHERE key LIKE ${"%" + author + "%"}`;
    await sql`DELETE FROM audit_events WHERE actor_id IN ${sql(userIds)}`;
    await sql`DELETE FROM users WHERE id IN ${sql(userIds)}`;
    await sql`DELETE FROM x_bot_usage WHERE kind=${prefix}`;
    await sql.end();
  });
  it("queues new posts transactionally once and respects author opt out", async () => {
    const id = await createPost();
    await sql.begin((tx) => enqueuePostPromotion(tx, id));
    const outbox = await sql`SELECT * FROM x_outbox WHERE resource_id=${id}`;
    expect(outbox).toHaveLength(1);
    expect((await renderOutbox(outbox[0]))?.text).toContain("@testauthor");
    await sql`UPDATE users SET preferences='{"xPromotionOptOut":true}' WHERE id=${author}`;
    expect(await renderOutbox(outbox[0])).toBeNull();
    await sql`UPDATE users SET preferences='{}' WHERE id=${author}`;
    await performAction((await getMemberById(author))!, {
      action: "withdrawXPromotion",
      postId: id,
    });
    expect(await renderOutbox(outbox[0])).toBeNull();
    const privateId = await createPost(false);
    expect(
      await sql`SELECT id FROM x_outbox WHERE resource_id=${privateId}`,
    ).toHaveLength(0);
  });
  it("holds ambiguous sends for reconciliation instead of repeating them", async () => {
    const id = await createPost();
    await sql`UPDATE x_outbox SET next_attempt_at=now(),created_at='1970-01-01' WHERE resource_id=${id}`;
    fetchMock.mockRejectedValue(
      new Error("timeout after server accepted request"),
    );
    await dispatchOutbox();
    const [item] =
      await sql`SELECT state FROM x_outbox WHERE resource_id=${id}`;
    expect(item.state).toBe("uncertain");
    fetchMock.mockClear();
    await dispatchOutbox();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never sends in dry-run and cancels deleted posts before delivery", async () => {
    vi.stubEnv("X_BOT_MODE", "dry-run");
    const id = await createPost();
    await sql`UPDATE x_outbox SET next_attempt_at=now(),created_at='1970-01-01' WHERE resource_id=${id}`;
    await dispatchOutbox();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (await sql`SELECT state FROM x_outbox WHERE resource_id=${id}`)[0].state,
    ).toBe("preview");
    await sql`UPDATE posts SET status='deleted' WHERE id=${id}`;
    await sql`UPDATE x_outbox SET state='queued' WHERE resource_id=${id}`;
    await dispatchOutbox();
    expect(
      (await sql`SELECT state FROM x_outbox WHERE resource_id=${id}`)[0].state,
    ).toBe("canceled");
  });
  it("retires pending invitations and never renders or sends their old codes", async () => {
    const requestId = `${prefix}-retired-request`;
    const deliveryId = `${prefix}-retired-delivery`;
    await sql`INSERT INTO x_invite_requests(id,x_id,handle,source_post_id,consent_text,state,profile) VALUES(${requestId},${`${numeric}1`},'requester',${`${numeric}11`},'old request','approved','{"name":"old profile"}')`;
    await sql`INSERT INTO x_outbox(id,dedupe_key,kind,resource_id,secret_payload,state) VALUES(${deliveryId},${deliveryId},'invite_dm',${requestId},'old-encrypted-code','queued')`;
    expect(
      await renderOutbox({
        kind: "invite_dm",
        resource_id: requestId,
        secret_payload: "old-encrypted-code",
      }),
    ).toBeNull();
    await retirePendingInvitations();
    const [request] =
      await sql`SELECT state,profile,consent_text FROM x_invite_requests WHERE id=${requestId}`;
    expect(request).toMatchObject({
      state: "stopped",
      profile: null,
      consent_text: "",
    });
    const [delivery] =
      await sql`SELECT state,secret_payload FROM x_outbox WHERE id=${deliveryId}`;
    expect(delivery).toMatchObject({ state: "canceled", secret_payload: null });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      performAction((await getMemberById(author))!, { action: "issueInvite" }),
    ).rejects.toMatchObject({ code: "INVITATIONS_RETIRED", status: 410 });
  });
  it("gives verified affiliates community badges and admits verified non-affiliates too", async () => {
    const xId = `${numeric}4`;
    await sql`INSERT INTO community_x_accounts(community_id,x_id,handle) VALUES(${community},'999998','exampleorg')`;
    await sql`INSERT INTO community_x_affiliations(community_id,x_id,source,evidence,expires_at) VALUES(${community},${xId},'x','official X API',now()+interval '1 day')`;
    const auth = await attempt(xId, 3);
    const admitted = await completeAdmission(auth.id, auth.token, auth.authId);
    userIds.push(admitted.memberId);
    const member = await getMemberById(admitted.memberId);
    expect(member?.isAdmin).toBe(false);
    expect(member?.admittedAt).toBeTruthy();
    const communities = await getCommunities(admitted.memberId);
    expect(
      communities
        .find((c) => c.id === community)
        ?.leaders?.some((l) => l.id === admitted.memberId),
    ).toBe(true);
    await performAction(member!, {
      action: "onboarding",
      acceptTerms: true,
      preferences: {},
    });
    expect(
      (await getCommunities(admitted.memberId)).find((c) => c.id === community)
        ?.isFollowing,
    ).toBe(true);
    const other = await attempt(`${numeric}5`, 4);
    const otherAdmission = await completeAdmission(
      other.id,
      other.token,
      other.authId,
    );
    userIds.push(otherAdmission.memberId);
    expect((await getMemberById(otherAdmission.memberId))?.isAdmin).toBe(false);
    expect(
      (await getCommunities(otherAdmission.memberId))
        .find((c) => c.id === community)
        ?.leaders?.some((leader) => leader.id === otherAdmission.memberId),
    ).toBe(false);
  });
  it("syncs official affiliates across pages and revokes missing affiliates only after a complete response", async () => {
    await sql`UPDATE community_x_accounts SET next_sync_at=now() WHERE community_id=${community}`;
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ id: `${numeric}6`, name: "First", username: "first" }],
        meta: { next_token: "page2" },
      }),
    );
    await syncOrganizationAffiliates();
    expect(
      (
        await sql`SELECT revoked_at FROM community_x_affiliations WHERE community_id=${community} AND x_id=${`${numeric}4`}`
      )[0].revoked_at,
    ).toBeNull();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ id: `${numeric}7`, name: "Second", username: "second" }],
        meta: {},
      }),
    );
    await syncOrganizationAffiliates();
    expect(
      (
        await sql`SELECT revoked_at FROM community_x_affiliations WHERE community_id=${community} AND x_id=${`${numeric}4`}`
      )[0].revoked_at,
    ).not.toBeNull();
    expect(
      (await getCommunities(author)).find((c) => c.id === community)?.leaders,
    ).toHaveLength(0);
  });
  it("counts actual 30-minute member sessions without duplicating concurrent visits", async () => {
    const t = new Date("2026-03-08T08:00:00Z");
    await Promise.all([
      recordMemberVisit(author, t),
      recordMemberVisit(author, t),
    ]);
    await recordMemberVisit(author, new Date(t.getTime() + 29 * 60000));
    await recordMemberVisit(author, new Date(t.getTime() + 60 * 60000));
    expect(
      await sql`SELECT id FROM member_visit_sessions WHERE member_id=${author}`,
    ).toHaveLength(2);
  });
  it("uses the previous local calendar day for highlights and excludes private posts", async () => {
    const shared = await createPost(),
      privateId = await createPost(false);
    await sql`UPDATE posts SET created_at='2026-03-08T08:30:00Z' WHERE id IN (${shared},${privateId})`;
    await sql`UPDATE post_votes SET created_at='2026-03-08T08:31:00Z' WHERE post_id IN (${shared},${privateId})`;
    await sql`INSERT INTO comments(id,post_id,author_id,body,created_at) VALUES(${`${prefix}-comment`},${shared},${author},'Useful','2026-03-09T06:59:00Z')`;
    vi.stubEnv("X_BOT_INCLUDE_SESSIONS", "1");
    const digest = await buildDigest("2026-03-08");
    expect(digest.postId).toBe(shared);
    expect(digest.comments).toBe(1);
    expect(digest.sessions).toBe(2);
    expect(digest.text).toContain("@testauthor");
  });
  it("keeps malformed affiliate responses from revoking trusted evidence", async () => {
    await sql`UPDATE community_x_accounts SET next_sync_at=now() WHERE community_id=${community}`;
    fetchMock.mockResolvedValueOnce(Response.json({}));
    await syncOrganizationAffiliates();
    expect(
      (
        await sql`SELECT revoked_at FROM community_x_affiliations WHERE community_id=${community} AND x_id=${`${numeric}6`}`
      )[0].revoked_at,
    ).toBeNull();
    expect(
      (
        await sql`SELECT last_error FROM community_x_accounts WHERE community_id=${community}`
      )[0].last_error,
    ).toBe("AFFILIATES_UNAVAILABLE");
  });
  it("enforces daily reservations atomically and protects admin and cron routes", async () => {
    const reserved = await Promise.all(
      Array.from({ length: 10 }, () => reserveBotUsage(prefix, 3)),
    );
    expect(reserved.filter(Boolean)).toHaveLength(3);
    expect(
      (await adminGet(new Request("http://127.0.0.1/api/admin/x-bot"))).status,
    ).toBe(401);
    expect(
      (await cronGet(new Request("http://127.0.0.1/api/jobs/x"))).status,
    ).toBe(403);
    vi.stubEnv("X_BOT_MODE", "off");
    expect(await runXGrowthJobs()).toEqual({ mode: "off" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
