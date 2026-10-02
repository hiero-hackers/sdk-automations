import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Never collect Stryker's sandbox copies of the suite.
        exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/**/*.ts"],
            // The composed barrel and the three it composes re-export and
            // hold nothing. `src/shell/compose/main.ts` and the live fill it
            // builds are exercised as a real process in
            // test/shell/compose/main.test.ts, and v8 attributes nothing across a
            // spawn — the barrels' reason exactly.
            exclude: [
                "src/index.ts",
                "src/adapter/index.ts",
                "src/shell/index.ts",
                "src/store/index.ts",
                "src/shell/compose/main.ts",
                "src/shell/compose/live.ts",
                "src/shell/observe/explain-cli.ts",
                "src/shell/observe/status-cli.ts",
                "src/shell/observe/backup-cli.ts",
            ],
            // The strictest of the three floors the former packages carried,
            // and still just below the measured 99.31/99.68/98.82/99.31 —
            // close enough to fire on a real regression, loose enough not to
            // flap. The uncovered branches are the ones argued in the source
            // as unreachable, where Stryker's disables say the same thing.
            thresholds: {
                lines: 98,
                branches: 98,
                functions: 98,
                statements: 98,
            },
        },
    },
});
