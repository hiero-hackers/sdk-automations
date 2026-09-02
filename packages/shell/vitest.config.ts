import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Never collect Stryker's sandbox copies of the suite.
        exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/**/*.ts"],
            // main.ts is exercised as a real process in test/main.test.ts, and
            // v8 attributes nothing across a spawn — index.ts's reason exactly.
            exclude: ["src/index.ts", "src/main.ts"],
            // Set below the measured 100/98.46/100/100 — close enough to
            // fire on a real regression, loose enough not to flap. The two
            // uncovered branches are the ones argued in the source as
            // unreachable, where Stryker's disables say the same thing.
            thresholds: {
                lines: 98,
                branches: 96,
                functions: 98,
                statements: 98,
            },
        },
    },
});
