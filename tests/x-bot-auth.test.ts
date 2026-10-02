import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "../src/server/db";
import { ensureAuthDatabase } from "../src/lib/auth-store";
import {
  botAccessToken,
  BOT_SCOPES,
  finishBotConnection,
  startBotConnection,
} from "../src/server/x-bot-auth";
import {
  openBotSecret,
  sealBotSecret,
  xBotRequest,
} from "../src/server/x-bot-provider";
const fetchMock = vi.fn();
let saved: Record<string, unknown>[] = [];
const enabled = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!enabled)("Bot OAuth isolation", () => {
  beforeAll(async () => {
    await ensureAuthDatabase();
    saved =
      await sql`SELECT * FROM x_bot_state WHERE key IN ('credentials','identity')`;
  });
  beforeEach(async () => {
    for (const [key, value] of Object.entries({
      X_BOT_USER_ID: "900000001",
      X_BOT_CLIENT_ID: "bot-client",
      X_BOT_CLIENT_SECRET: "bot-client-secret",
      BETTER_AUTH_SECRET: "test-bot-encryption-secret-".repeat(3),
      APP_URL: "https://reddix.test",
      X_BOT_MODE: "dry-run",
    }))
      vi.stubEnv(key, value);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await sql`DELETE FROM x_bot_state WHERE key IN ('credentials','identity')`;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await sql`DELETE FROM x_bot_state WHERE key IN ('credentials','identity') OR (key LIKE 'oauth:%' AND value->>'memberId' LIKE 'bot-auth-test-%')`;
    for (const row of saved)
      await sql`INSERT INTO x_bot_state(key,value,lease_until,updated_at) VALUES(${String(row.key)},${sql.json(row.value as never)},${row.lease_until as Date | null},${row.updated_at as Date})`;
    await sql.end();
  });
  it("binds state to the initiating admin, uses PKCE, checks identity and consumes state once", async () => {
    const admin = `bot-auth-test-${randomUUID()}`;
    const url = new URL(await startBotConnection(admin));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(BOT_SCOPES);
    const state = url.searchParams.get("state")!;
    await expect(
      finishBotConnection("different-admin", state, "code"),
    ).rejects.toMatchObject({ code: "BOT_OAUTH_STATE_INVALID" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        access_token: "private-bot-token",
        refresh_token: "private-refresh-token",
        expires_in: 7200,
        scope: BOT_SCOPES.join(" "),
      }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: { id: "900000001", name: "Reddix", username: "reddix" },
      }),
    );
    await finishBotConnection(admin, state, "code");
    const [row] =
      await sql`SELECT value FROM x_bot_state WHERE key='credentials'`;
    expect(JSON.stringify(row)).not.toContain("private-bot-token");
    expect(JSON.parse(openBotSecret(row.value.sealed)).accessToken).toBe(
      "private-bot-token",
    );
    await expect(
      finishBotConnection(admin, state, "code"),
    ).rejects.toMatchObject({ code: "BOT_OAUTH_STATE_INVALID" });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      Response.json({
        data: { id: "900000001", name: "Reddix", username: "reddix" },
      }),
    );
    await xBotRequest("/2/users/me");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer private-bot-token",
    );
  });
  it("rejects authorizing a member account as the bot", async () => {
    const admin = `bot-auth-test-${randomUUID()}`,
      url = new URL(await startBotConnection(admin));
    fetchMock.mockResolvedValueOnce(
      Response.json({
        access_token: "wrong-token",
        refresh_token: "wrong-refresh",
        expires_in: 7200,
        scope: BOT_SCOPES.join(" "),
      }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { id: "111", name: "Wrong", username: "wrong" } }),
    );
    await expect(
      finishBotConnection(admin, url.searchParams.get("state")!, "code"),
    ).rejects.toMatchObject({ code: "BOT_IDENTITY_MISMATCH" });
    expect(
      await sql`SELECT key FROM x_bot_state WHERE key='credentials'`,
    ).toHaveLength(0);
  });
  it("serializes refresh token rotation and keeps refreshed credentials encrypted", async () => {
    await sql`INSERT INTO x_bot_state(key,value) VALUES('credentials',${sql.json({ xId: "900000001", sealed: sealBotSecret(JSON.stringify({ accessToken: "old", refreshToken: "old-refresh", expiresAt: 1 })) })})`;
    fetchMock.mockResolvedValue(
      Response.json({
        access_token: "new",
        refresh_token: "new-refresh",
        expires_in: 7200,
        scope: BOT_SCOPES.join(" "),
      }),
    );
    expect(await Promise.all([botAccessToken(), botAccessToken()])).toEqual([
      "new",
      "new",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
