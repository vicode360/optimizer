import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "./package.json"), "utf8")
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
});
