/**
 * Negative controls and regression tests for incremental mutation invalidation policy.
 */

import { describe, expect, it } from "vitest";
import {
    discoverWorkspaceDependencies,
    shouldForceMutation,
    type WorkspaceDependencyMap,
} from "./mutation-invalidation.js";

describe("mutation invalidation policy guarantees safe incremental reuse", () => {
    const workspaceDeps: WorkspaceDependencyMap = {
        core: { dependencies: [], consumesTestkit: true },
        capabilities: { dependencies: ["core"], consumesTestkit: false },
        runtime: { dependencies: ["capabilities", "core"], consumesTestkit: true },
    };

    it("discovers workspace dependencies accurately from repository manifests", () => {
        const discovered = discoverWorkspaceDependencies();
        expect(discovered.core?.dependencies).toEqual([]);
        expect(discovered.core?.consumesTestkit).toBe(true);

        expect(discovered.runtime?.dependencies).toEqual(["capabilities", "core"]);
        expect(discovered.runtime?.consumesTestkit).toBe(true);

        expect(discovered.capabilities?.dependencies).toEqual(["core"]);
        expect(discovered.capabilities?.consumesTestkit).toBe(false);
    });

    // Control 1: an ordinary changed mutated source file may use incremental mode
    it("permits incremental mode when only mutated source files or test specs changed in the package", () => {
        const changed = [
            "packages/core/src/safety/validator.ts",
            "packages/core/test/safety/validator.test.ts",
        ];
        const decision = shouldForceMutation("core", changed, workspaceDeps);
        expect(decision.force).toBe(false);
    });

    // Control 2: a package-local helper change forces a full run
    it("forces a full mutation run when a package-local test helper or fixture changes", () => {
        const helperChanged = ["packages/core/test/config/builders.ts"];
        expect(shouldForceMutation("core", helperChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/test/config/builders.ts",
        });

        const storeHelperChanged = ["packages/runtime/test/store/worker-build.ts"];
        expect(shouldForceMutation("runtime", storeHelperChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/runtime/test/store/worker-build.ts",
        });

        const configDocumentChanged = ["packages/core/test/config/documents.ts"];
        expect(shouldForceMutation("core", configDocumentChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/test/config/documents.ts",
        });
    });

    it("forces a full mutation run when package configuration changes", () => {
        expect(
            shouldForceMutation("core", ["packages/core/stryker.config.json"], workspaceDeps),
        ).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/stryker.config.json",
        });
        expect(
            shouldForceMutation("core", ["packages/core/vitest.config.ts"], workspaceDeps),
        ).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/vitest.config.ts",
        });
        expect(shouldForceMutation("core", ["packages/core/tsconfig.json"], workspaceDeps)).toEqual(
            {
                force: true,
                reason: "package-local helper, fixture, or configuration changed: packages/core/tsconfig.json",
            },
        );
        expect(shouldForceMutation("core", ["packages/core/package.json"], workspaceDeps)).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/package.json",
        });
    });

    // Control 3: a shared testkit helper or fixture change forces affected packages
    it("forces a full run on every package consuming testkit when testkit changes", () => {
        const testkitCodeChanged = ["packages/dev/testkit/src/index.ts"];
        expect(shouldForceMutation("core", testkitCodeChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "shared testkit changed: packages/dev/testkit/src/index.ts",
        });
        expect(shouldForceMutation("runtime", testkitCodeChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "shared testkit changed: packages/dev/testkit/src/index.ts",
        });
        // capabilities does not consume testkit
        expect(shouldForceMutation("capabilities", testkitCodeChanged, workspaceDeps)).toEqual({
            force: false,
        });

        const fixtureChanged = ["packages/dev/testkit/fixtures/issues.opened.json"];
        expect(shouldForceMutation("core", fixtureChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "shared testkit changed: packages/dev/testkit/fixtures/issues.opened.json",
        });
    });

    // Control 4: a relevant workspace dependency change forces the dependent package
    it("forces a full run on dependent packages when a workspace dependency changes", () => {
        const coreChanged = ["packages/core/src/types.ts"];

        // the runtime depends on core
        expect(shouldForceMutation("runtime", coreChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "workspace dependency 'core' changed: packages/core/src/types.ts",
        });

        // capabilities depends on core
        expect(shouldForceMutation("capabilities", coreChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "workspace dependency 'core' changed: packages/core/src/types.ts",
        });

        // core itself changed only source, so core uses incremental mode
        expect(shouldForceMutation("core", coreChanged, workspaceDeps)).toEqual({
            force: false,
        });

        // capabilities changed: forces the runtime (which composes them), but not core
        const capabilitiesChanged = ["packages/capabilities/src/index.ts"];
        expect(shouldForceMutation("runtime", capabilitiesChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "workspace dependency 'capabilities' changed: packages/capabilities/src/index.ts",
        });
        expect(shouldForceMutation("core", capabilitiesChanged, workspaceDeps)).toEqual({
            force: false,
        });
    });

    // Control 5: a documentation-only change does not force unrelated full mutation runs
    it("does not force full runs on documentation-only changes", () => {
        const docChanges = [
            "README.md",
            "CONTRIBUTING.md",
            "design/architecture.md",
            "design/guides/threat-model.md",
            "docs/quickstart.md",
            "packages/dev/lab/protocols/6.2-webhook-delivery.md",
            "packages/dev/checks/README.md",
        ];
        expect(shouldForceMutation("core", docChanges, workspaceDeps)).toEqual({ force: false });
        expect(shouldForceMutation("capabilities", docChanges, workspaceDeps)).toEqual({
            force: false,
        });
        expect(shouldForceMutation("runtime", docChanges, workspaceDeps)).toEqual({
            force: false,
        });
    });

    it("forces capabilities when the shipped examples its tests read change", () => {
        const exampleChanged = ["docs/examples/full.yml"];
        expect(shouldForceMutation("capabilities", exampleChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "test input outside the package changed: docs/examples/full.yml",
        });
        expect(shouldForceMutation("core", exampleChanged, workspaceDeps)).toEqual({
            force: false,
        });
    });

    it("forces all packages when global lockfile or root configuration changes", () => {
        for (const file of [
            "pnpm-lock.yaml",
            "package.json",
            "pnpm-workspace.yaml",
            "tsconfig.json",
        ]) {
            expect(shouldForceMutation("core", [file], workspaceDeps)).toEqual({
                force: true,
                reason: `global dependency or configuration file changed: ${file}`,
            });
            expect(shouldForceMutation("runtime", [file], workspaceDeps)).toEqual({
                force: true,
                reason: `global dependency or configuration file changed: ${file}`,
            });
        }
    });
});
