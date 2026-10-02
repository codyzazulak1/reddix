import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(".local/postgres");
const log = resolve(".local/postgres.log");
const port = process.env.REDDIX_DB_PORT || "55432";
const command = process.argv[2] || "start";
function run(program, args, allowFailure = false) {
  const result = spawnSync(program, args, { stdio: "inherit" });
  if (result.error)
    throw new Error(
      `${program} is needed. Install PostgreSQL locally or use docker compose up -d. ${result.error.message}`,
    );
  if (result.status !== 0 && !allowFailure) process.exit(result.status || 1);
  return result.status;
}
mkdirSync(resolve(".local"), { recursive: true });
if (command === "stop") {
  if (existsSync(dir)) run("pg_ctl", ["-D", dir, "stop", "-m", "fast"], true);
} else {
  if (!existsSync(resolve(dir, "PG_VERSION")))
    run("initdb", [
      "-D",
      dir,
      "-U",
      "reddix",
      "--auth=trust",
      "--encoding=UTF8",
      "--locale=C",
    ]);
  const status = spawnSync("pg_ctl", ["-D", dir, "status"], {
    stdio: "ignore",
  });
  if (status.status !== 0)
    run("pg_ctl", [
      "-D",
      dir,
      "-l",
      log,
      "-o",
      `-h 127.0.0.1 -p ${port} -k ${resolve(".local")}`,
      "start",
    ]);
  run(
    "createdb",
    ["-h", "127.0.0.1", "-p", port, "-U", "reddix", "reddix"],
    true,
  );
  console.log(
    `Local Reddix database is available on 127.0.0.1:${port}. Development only.`,
  );
}
