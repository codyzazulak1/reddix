import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureAuthDatabase } from "../src/lib/auth-store";
import { hardenDatabasePrivacy, sql } from "../src/server/db";

describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "private database boundary",
  () => {
    let appTables: string[];

    beforeAll(async () => {
      await ensureAuthDatabase();
      const migrations = (await readdir(path.join(process.cwd(), "db")))
        .filter((file) => file.endsWith(".sql"))
        .map((file) => path.join(process.cwd(), "db", file));
      const sources = await Promise.all(
        [...migrations, path.join(process.cwd(), "src/lib/auth-store.ts")].map(
          (file) => readFile(file, "utf8"),
        ),
      );
      appTables = [
        ...new Set(
          sources.flatMap((source) =>
            [...source.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
              (match) => match[1],
            ),
          ),
        ),
      ];
    });

    it("protects every application and authentication table while preserving owner access", async () => {
      const tables = await sql`
        SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ${sql(appTables)}`;
      expect(tables).toHaveLength(appTables.length);
      for (const table of tables) {
        expect(table.relrowsecurity, table.relname).toBe(true);
        expect(table.relforcerowsecurity, table.relname).toBe(false);
      }
      // The application owner still reads seeded communities and auth records.
      expect((await sql`SELECT id FROM communities LIMIT 1`).length).toBe(1);
      await expect(
        sql`SELECT id FROM auth_session LIMIT 1`,
      ).resolves.toBeDefined();
      const privileges = await sql`
        SELECT c.relname,acl.grantee,acl.privilege_type
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        WHERE n.nspname='public' AND c.relname IN ${sql(appTables)}
        AND (acl.grantee=0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')))`;
      expect(privileges).toEqual([]);
    });

    it("repairs existing public grants on auth, application tables and their sequences without changing unrelated tables", async () => {
      const rollback = new Error("Roll back privacy verification fixtures.");
      await expect(
        sql.begin(async (tx) => {
          await tx`CREATE TABLE public.reddix_privacy_unrelated_test(id text)`;
          await tx`GRANT SELECT ON public.reddix_privacy_unrelated_test TO PUBLIC`;
          await tx`GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.auth_session,public.posts TO PUBLIC`;
          await tx`GRANT USAGE,SELECT,UPDATE ON SEQUENCE public.chat_messages_sequence_seq TO PUBLIC`;
          await tx`ALTER TABLE public.auth_session DISABLE ROW LEVEL SECURITY`;
          await hardenDatabasePrivacy(tx);
          const exposed = await tx`
            SELECT c.relname FROM pg_class c
            CROSS JOIN LATERAL aclexplode(c.relacl) acl
            WHERE c.oid IN ('public.auth_session'::regclass,'public.posts'::regclass,'public.chat_messages_sequence_seq'::regclass)
            AND acl.grantee=0`;
          expect(exposed).toEqual([]);
          const [auth] =
            await tx`SELECT relrowsecurity FROM pg_class WHERE oid='public.auth_session'::regclass`;
          expect(auth.relrowsecurity).toBe(true);
          const [unrelated] =
            await tx`SELECT relrowsecurity,EXISTS(SELECT 1 FROM aclexplode(relacl) acl WHERE acl.grantee=0 AND acl.privilege_type='SELECT') AS public_read FROM pg_class WHERE oid='public.reddix_privacy_unrelated_test'::regclass`;
          expect(unrelated.relrowsecurity).toBe(false);
          expect(unrelated.public_read).toBe(true);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });
  },
);
