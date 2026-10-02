import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env.local")) {
  console.log("Keeping your existing .env.local configuration.");
} else {
  let config = readFileSync(".env.example", "utf8");
  for (const name of ["BETTER_AUTH_SECRET", "CRON_SECRET"]) {
    config = config.replace(
      `${name}=\n`,
      `${name}=${randomBytes(32).toString("hex")}\n`,
    );
  }
  writeFileSync(".env.local", config, { mode: 0o600, flag: "wx" });
  console.log(
    "Local configuration created with fresh development secrets. No credentials were printed.",
  );
}
