import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
});
