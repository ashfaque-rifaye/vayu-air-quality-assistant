import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Logic tests run in Node; component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock, so the fast suite stays fast.
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Run test files sequentially in one worker. Spinning up many parallel jsdom
    // environments in forked workers is unstable on some platforms; the suite is
    // fast enough that serial execution costs little and is reliable in CI.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        // Process entry points and host wiring: they only connect pieces that are
        // tested in isolation, and run only against a real Node server or Vercel.
        "src/client/main.tsx",
        "src/server/index.ts",
        "src/server/bootstrap.ts",
        "src/server/static.ts",
      ],
      // Enforced in CI, set just under the measured figures so a drop fails the build.
      thresholds: { lines: 98, statements: 97, functions: 97, branches: 89 },
    },
  },
});
