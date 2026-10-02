import postgres, { type TransactionSql } from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";

const globalDb = globalThis as typeof globalThis & {
  reddixSql?: ReturnType<typeof postgres>;
  reddixReady?: Promise<void>;
};
export const sql =
  globalDb.reddixSql ??
  postgres(
    process.env.DATABASE_URL ?? "postgresql://reddix@127.0.0.1:55432/reddix",
    {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => {},
    },
  );
if (process.env.NODE_ENV !== "production") globalDb.reddixSql = sql;

export function ensureDatabase(): Promise<void> {
  if (!globalDb.reddixReady) {
    globalDb.reddixReady = (async () => {
      if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL)
        throw new Error("DATABASE_URL is required in production.");
      if (
        process.env.AUTO_MIGRATE === "1" &&
        process.env.NODE_ENV !== "production"
      )
        await migrateDatabase();
      else {
        const [tables] =
          await sql`SELECT to_regclass('public.schema_migrations') AS migrations,to_regclass('public.feed_snapshots') AS snapshots`;
        if (!tables.migrations || !tables.snapshots)
          throw new Error(
            "The Reddix database needs setup. Run pnpm db:setup with DATABASE_URL configured.",
          );
        const [version] =
          await sql`SELECT version FROM schema_migrations WHERE version='006'`;
        if (!version)
          throw new Error(
            "The Reddix schema is out of date. Run pnpm db:setup.",
          );
      }
    })().catch((error) => {
      globalDb.reddixReady = undefined;
      throw error;
    });
  }
  return globalDb.reddixReady;
}

/** Explicit schema setup for the deployment CLI. Production requests never migrate. */
export async function migrateDatabase(): Promise<void> {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required in production.");
  const migrations = await Promise.all(
    [
      "001_initial.sql",
      "002_chat.sql",
      "003_moderation.sql",
      "004_x_growth.sql",
      "005_private_database.sql",
      "006_community_suggestion_reviews.sql",
    ].map((file) => readFile(path.join(process.cwd(), "db", file), "utf8")),
  );
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(921872)`;
    for (const migration of migrations) await tx.unsafe(migration);
  });
  const { seedDatabase } = await import("./seed");
  await seedDatabase();
}

/** Auth tables are created separately and must be private before they commit. */
export async function hardenDatabasePrivacy(tx: TransactionSql): Promise<void> {
  const migration = await readFile(
    path.join(process.cwd(), "db", "005_private_database.sql"),
    "utf8",
  );
  await tx.unsafe(migration);
}
