import { betterAuth } from "better-auth";
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
} from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { deleteSessionCookie } from "better-auth/cookies";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./auth-schema";
import { safeReturnPath, validateAuthEnvironment } from "./auth-policy";
import {
  ATTEMPT_COOKIE,
  PASS_COOKIE,
  completeAdmission,
  createAuthenticationAttempt,
  ensureAuthDatabase,
  findAdmissionAttempt,
  recordAttemptProfile,
} from "./auth-store";
import { fetchXProfile } from "./auth-x";
import { DomainError } from "@/server/domain";

export function xConfigured(): boolean {
  return !!(
    process.env.X_CLIENT_ID &&
    process.env.X_CLIENT_SECRET &&
    process.env.BETTER_AUTH_SECRET &&
    process.env.BETTER_AUTH_URL
  );
}

export const authCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

function createAuth() {
  validateAuthEnvironment();
  if (!xConfigured())
    throw new Error(
      "X sign-in is not configured yet. Add the X developer app credentials to enable it.",
    );
  // Drizzle replaces postgres-js date/JSON serializers on its client. Keeping a
  // separate pool prevents it from changing the domain service SQL semantics.
  const authSql = postgres(
    process.env.DATABASE_URL ?? "postgresql://reddix@127.0.0.1:55432/reddix",
    { max: 4, prepare: false, idle_timeout: 20 },
  );
  const auth = betterAuth({
    appName: "Reddix",
    baseURL: process.env.BETTER_AUTH_URL!,
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET!,
    database: drizzleAdapter(drizzle(authSql, { schema }), {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [new URL(process.env.BETTER_AUTH_URL!).origin],
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      freshAge: 60 * 15,
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: false, disableImplicitLinking: true },
      storeStateStrategy: "database",
    },
    socialProviders: {
      twitter: {
        clientId: process.env.X_CLIENT_ID!,
        clientSecret: process.env.X_CLIENT_SECRET!,
        disableDefaultScope: true,
        scope: ["users.read", "tweet.read", "offline.access"],
        overrideUserInfoOnSignIn: false,
        // The installed 1.7.6 provider requests users.email by default and does a
        // second email lookup. Use the documented custom user-info extension so
        // optional email access is never required for a Reddix identity.
        getUserInfo: async (tokens) => {
          if (!tokens.accessToken) return null;
          const state = await getOAuthState();
          const attemptId = state?.serverContext?.admissionAttemptId;
          if (typeof attemptId !== "string")
            throw new APIError("FORBIDDEN", {
              message: "Start sign-in from the Reddix admission page.",
            });
          const profile = await fetchXProfile(tokens.accessToken);
          await recordAttemptProfile(attemptId, profile);
          return {
            user: {
              name: profile.name,
              image: profile.avatar ?? undefined,
              email: `${profile.xId}@x.reddix.invalid`,
              emailVerified: false,
            },
            data: {
              data: {
                id: profile.xId,
                name: profile.name,
                username: profile.handle,
              },
            },
          };
        },
      },
    },
    advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
    rateLimit: { enabled: true, window: 60, max: 30 },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await ensureAuthDatabase();
        if (
          [
            "/update-user",
            "/change-email",
            "/link-social",
            "/unlink-account",
            "/sign-up/email",
            "/sign-in/email",
          ].includes(ctx.path)
        ) {
          throw new APIError("FORBIDDEN", {
            message:
              "Reddix identities can only be updated by resyncing the same X account.",
          });
        }
        if (ctx.path === "/sign-in/social") {
          if (ctx.body?.provider !== "twitter" || ctx.body?.idToken)
            throw new APIError("FORBIDDEN", {
              message: "Only the X OAuth redirect flow is supported.",
            });
          let token = ctx.getCookie(ATTEMPT_COOKIE);
          let attempt = token ? await findAdmissionAttempt(token) : null;
          if (!attempt) {
            const created = await createAuthenticationAttempt(
              ctx.getCookie(PASS_COOKIE),
            );
            token = created.token;
            attempt = await findAdmissionAttempt(token);
          }
          if (!attempt)
            throw new APIError("FORBIDDEN", {
              message: "A valid admission attempt is required.",
            });
          ctx.body.callbackURL = safeReturnPath(ctx.body.callbackURL);
          ctx.body.newUserCallbackURL = ctx.body.callbackURL;
          ctx.body.errorCallbackURL = "/?authError=x-sign-in";
          ctx.body.scopes = ["users.read", "tweet.read", "offline.access"];
          ctx.body.additionalData = {};
          ctx.body.additionalParams = {};
          await addOAuthServerContext({ admissionAttemptId: attempt.id });
          return { context: { context: { admissionAttemptToken: token } } };
        }
        if (ctx.path.startsWith("/callback/")) {
          const token = ctx.getCookie(ATTEMPT_COOKIE);
          if (
            ctx.params?.id !== "twitter" ||
            !token ||
            !(await findAdmissionAttempt(token))
          )
            throw new APIError("FORBIDDEN", {
              message: "Admission expired. Start again from Reddix.",
            });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/social") {
          // The provider response replaces before-hook headers in this version
          // of Better Auth. Write the attempt cookie after the endpoint runs.
          const token = (
            ctx.context as typeof ctx.context & {
              admissionAttemptToken?: string;
            }
          ).admissionAttemptToken;
          if (token)
            ctx.setCookie(ATTEMPT_COOKIE, token, authCookieOptions(600));
          return;
        }
        if (!ctx.path.startsWith("/callback/") || !ctx.context.newSession)
          return;
        const state = await getOAuthState();
        const attemptId = state?.serverContext?.admissionAttemptId;
        const token = ctx.getCookie(ATTEMPT_COOKIE);
        if (typeof attemptId !== "string" || !token)
          throw new APIError("FORBIDDEN", {
            message: "Admission state is missing.",
          });
        try {
          const admitted = await completeAdmission(
            attemptId,
            token,
            ctx.context.newSession.user.id,
          );
          ctx.setCookie(
            PASS_COOKIE,
            admitted.passToken,
            authCookieOptions(90 * 86400),
          );
          ctx.setCookie(ATTEMPT_COOKIE, "", authCookieOptions(0));
        } catch (error) {
          // An auth-library identity may already exist. It remains unadmitted
          // and cannot pass currentMember(), even if a cookie was issued.
          await ctx.context.internalAdapter.deleteSession(
            ctx.context.newSession.session.token,
          );
          deleteSessionCookie(ctx);
          ctx.setCookie(ATTEMPT_COOKIE, "", authCookieOptions(0));
          const reason =
            error instanceof DomainError &&
            error.code === "X_VERIFICATION_REQUIRED"
              ? "verification-required"
              : error instanceof DomainError &&
                  error.code === "X_VERIFICATION_UNAVAILABLE"
                ? "verification-unavailable"
                : "admission";
          throw ctx.redirect(`/?authError=${reason}`);
        }
      }),
    },
  });
  return auth;
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
