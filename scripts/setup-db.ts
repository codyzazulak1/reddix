import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
async function main() {
  const { migrateDatabase, sql } = await import("../src/server/db");
  const { migrateAuthDatabase } = await import("../src/lib/auth-store");
  await migrateDatabase();
  await migrateAuthDatabase();
  console.log("Reddix database schema is ready.");
  await sql.end();
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Database setup failed.",
  );
  process.exitCode = 1;
});
