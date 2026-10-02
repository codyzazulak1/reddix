import { describe, expect, it } from "vitest";
import {
  hasFreshVerification,
  hasSignupVerification,
  isDevelopmentAuth,
  normalizeVerification,
  safeReturnPath,
  validateAuthEnvironment,
} from "../src/lib/auth-policy";
import { parseXProfile } from "../src/lib/auth-x";

describe("X identity and verified signup security policy", () => {
  it("requires explicit local development mode and rejects it in production", () => {
    expect(
      isDevelopmentAuth({ NODE_ENV: "test", AUTH_MODE: "development" }),
    ).toBe(true);
    expect(
      isDevelopmentAuth({ NODE_ENV: "production", AUTH_MODE: "development" }),
    ).toBe(false);
    expect(isDevelopmentAuth({ NODE_ENV: "development" })).toBe(false);
    expect(() =>
      validateAuthEnvironment({
        NODE_ENV: "production",
        AUTH_MODE: "development",
      }),
    ).toThrow();
    expect(() =>
      validateAuthEnvironment({ NODE_ENV: "production", AUTH_MODE: "x" }),
    ).toThrow("DATABASE_URL");
  });

  it("configures production X authentication without an invitation secret", () => {
    const env = {
      NODE_ENV: "production" as const,
      AUTH_MODE: "x",
      DATABASE_URL: "postgresql://test@127.0.0.1/reddix",
      BETTER_AUTH_SECRET:
        "test-only-session-secret-with-more-than-32-characters",
      BETTER_AUTH_URL: "https://reddix.example",
      X_CLIENT_ID: "test-client-id",
      X_CLIENT_SECRET: "test-client-secret",
    };
    expect(() => validateAuthEnvironment(env)).not.toThrow();
    expect(() =>
      validateAuthEnvironment({ ...env, BETTER_AUTH_SECRET: "too-short" }),
    ).toThrow();
    expect(() =>
      validateAuthEnvironment({
        ...env,
        BETTER_AUTH_URL: "http://reddix.example",
      }),
    ).toThrow("HTTPS");
  });

  it("accepts all authoritative X verification types for signup", () => {
    for (const type of ["blue", "business", "government"]) {
      expect(hasSignupVerification(type)).toBe(true);
    }
    for (const type of ["none", "unknown", "premium", "true", ""]) {
      expect(hasSignupVerification(type)).toBe(false);
    }
  });

  it("does not infer verification from a subscription or legacy verified flag", () => {
    expect(
      normalizeVerification({
        verified: true,
        subscription_type: "PremiumPlus",
      }),
    ).toBe("unknown");
    expect(
      normalizeVerification({ verified_type: "blue", verified: false }),
    ).toBe("blue");
    expect(normalizeVerification({ verified_type: "business" })).toBe(
      "business",
    );
    expect(normalizeVerification({ verified_type: "government" })).toBe(
      "government",
    );
    expect(normalizeVerification({ verified_type: "none" })).toBe("none");
    expect(normalizeVerification({ verified_type: "premium" })).toBe("unknown");
    expect(normalizeVerification({ verified: true })).toBe("unknown");
  });

  it("preserves the fresh blue/business requirement for participation", () => {
    expect(hasFreshVerification("blue", new Date(2000), 1000)).toBe(true);
    expect(hasFreshVerification("business", new Date(1000), 1000)).toBe(false);
    expect(hasFreshVerification("government", new Date(2000), 1000)).toBe(
      false,
    );
  });

  it("keeps immutable X IDs and sanitizes optional links", () => {
    const profile = parseXProfile({
      id: "9876543210987654321",
      name: "Alex",
      username: "alex",
      verified_type: "blue",
      url: "javascript:alert(1)",
    });
    expect(profile.xId).toBe("9876543210987654321");
    expect(profile.website).toBeNull();
    expect(profile.followers).toBeNull();
    expect(() =>
      parseXProfile({ id: "987", name: "Alex", username: "alex" }, "123"),
    ).toThrow("same X account");
    expect(() =>
      parseXProfile({ id: 987, name: "Alex", username: "alex" }),
    ).toThrow("incomplete");
  });

  it("does not accept external or protocol-relative post-login redirects", () => {
    expect(safeReturnPath("/events?city=sf")).toBe("/events?city=sf");
    for (const value of [
      "https://attacker.example",
      "//attacker.example",
      "/\\attacker.example",
      "/api/auth/logout",
      "/auth/loop",
      " /events",
    ]) {
      expect(safeReturnPath(value)).toBe("/popular");
    }
  });
});
