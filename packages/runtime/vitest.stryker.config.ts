import { mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

// Stryker reruns every test that covers a mutant; these end-to-end suites cover most of the
// runtime and wait out real one-second read-backs, so the unit tests are left to kill mutants.
export default mergeConfig(base, {
    test: {
        exclude: [
            "test/shell/compose/action-modes.test.ts",
            "test/shell/compose/replay.test.ts",
            "test/shell/compose/rough-edges.test.ts",
        ],
    },
});
