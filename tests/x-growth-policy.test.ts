import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inviteCommand,
  previousLocalDay,
  publicTitle,
} from "../src/server/x-growth-policy";
import {
  botConfig,
  openBotSecret,
  sealBotSecret,
  xBotRequest,
} from "../src/server/x-bot-provider";
import { classifyInvite } from "../src/server/x-invite-classifier";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("X growth boundaries", () => {
  it("uses calendar days across Pacific daylight saving changes", () => {
    expect(previousLocalDay(new Date("2026-03-09T07:00:00Z"))).toBe(
      "2026-03-08",
    );
    expect(previousLocalDay(new Date("2026-11-02T08:00:00Z"))).toBe(
      "2026-11-01",
    );
    expect(previousLocalDay(new Date("2026-09-28T06:59:59Z"))).toBe(
      "2026-09-26",
    );
    expect(previousLocalDay(new Date("2026-09-28T07:00:00Z"))).toBe(
      "2026-09-27",
    );
  });
  it("requires an explicit DM request to the configured bot", () => {
    expect(inviteCommand("@reddix DM me an invite", "reddix")).toBe("invite");
    expect(
      inviteCommand("@ReDdIx please DM me an invite code!", "reddix"),
    ).toBe("invite");
    expect(inviteCommand("@reddix stop", "reddix")).toBe("stop");
    for (const text of [
      "hey @reddix",
      "@other DM me an invite",
      "@reddix @victim DM me an invite",
      "RT @reddix DM me an invite",
      "@reddix do not DM me an invite",
    ])
      expect(inviteCommand(text, "reddix")).toBeNull();
  });
  it("neutralizes title mentions and URLs and bounds wide characters", () => {
    expect(publicTitle("@victim https://evil.test\nhello")).toBe(
      "＠victim [link] hello",
    );
    expect(publicTitle("😀".repeat(300)).length).toBeLessThan(150);
  });
  it("fails closed without configuration and blocks writes in preview", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("X_BOT_MODE", "off");
    await expect(
      xBotRequest("/2/tweets", {}, { text: "hello" }),
    ).rejects.toMatchObject({ code: "BOT_NOT_CONFIGURED" });
    for (const name of [
      "X_BOT_USER_ID",
      "X_BOT_CLIENT_ID",
      "X_BOT_CLIENT_SECRET",
    ])
      vi.stubEnv(name, "123");
    vi.stubEnv("X_BOT_MODE", "dry-run");
    await expect(
      xBotRequest("/2/tweets", {}, { text: "hello" }),
    ).rejects.toMatchObject({ code: "BOT_WRITES_DISABLED" });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(botConfig())).not.toContain("CLIENT_SECRET");
  });
  it("encrypts queued codes and rejects tampering", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(40));
    const sealed = sealBotSecret("ABC123_invite");
    expect(sealed).not.toContain("ABC123_invite");
    expect(openBotSecret(sealed)).toBe("ABC123_invite");
    const pieces = sealed.split(".");
    pieces[1] = Buffer.alloc(16).toString("base64url");
    expect(() => openBotSecret(pieces.join("."))).toThrow();
  });
  it("keeps uncertain and invalid AI approvals in human review", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const fetch = vi.fn().mockImplementation(async () =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                decision: "approve",
                confidence: 0.4,
                evidence: "technology",
                reason: "Ambiguous public profile.",
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await classifyInvite(
          {
            id: "100",
            username: "test",
            name: "Test",
            description: "Learning programming",
          },
          [],
        )
      ).decision,
    ).toBe("review");
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.provider.zdr).toBe(true);
    expect(payload.provider.data_collection).toBe("deny");
    expect(payload.messages[1].content).not.toContain('"name"');
    fetch.mockClear();
    expect(
      (
        await classifyInvite(
          { id: "100", username: "test", name: "Test", protected: true },
          [],
        )
      ).decision,
    ).toBe("review");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed model results and refusal responses", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ finish_reason: "length", message: { content: "{}" } }],
        }),
      ),
    );
    await expect(
      classifyInvite({ id: "100", username: "test", name: "Test" }, []),
    ).rejects.toThrow();
  });
});
