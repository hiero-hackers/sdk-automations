/**
 * The workspace dependency graph, as rules rather than as a hand-written
 * scanner.
 *
 * `packages/dev/checks/test/architecture.test.ts` is this file's ENFORCEMENT
 * GATE: it cruises the real tree with these rules and fails on any
 * violation, and it cruises a deliberately-violating fixture tree with the
 * same rules to prove they can still fire. There is no CLI step and no
 * separate CI job — if a rule here stops matching, that test goes red.
 *
 * The gate also supplies the roots to cruise (every workspace package's
 * `src/` and `test/`, plus the lab's local-only harness when it is present),
 * because that list is discovered from `pnpm-workspace.yaml` and a config
 * file cannot run discovery.
 *
 * These rules are a LAYER POLICY, not a copied workspace list. The role names
 * below are spelled out only because this file cannot execute the discovery
 * the gate does; everything else — which directories exist, which packages
 * are present — stays derived.
 *
 * Three of those roles — store, adapter and shell — are DIRECTORIES of the
 * runtime package rather than packages of their own (G4). The policy did not
 * change with the filing: the same rules, with the same names and the same
 * reasons, read a directory where they used to read a package.
 */

/**
 * Non-production packages live under `packages/dev/`, but the fixture tree
 * the gate cruises as its negative control mirrors packages FLAT under its
 * own root. `(?:dev/)?` lets one pattern govern both shapes — which is also
 * the proof the rules are about roles, not about where a role is filed.
 */
const P = "^packages/(?:dev/)?";

/**
 * The runtime's three internal roles, reached the same way from `src/` and
 * from `test/`. `R("store")` is where the former store package now lives;
 * `R("store|shell")` is the pair of them.
 */
const R = (roles) => `^packages/runtime/(?:src|test)/(?:${roles})/`;

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: "no-circular",
            severity: "error",
            comment:
                "A cycle makes the layer table unenforceable: whichever direction you read it in, " +
                "both packages are above the other. This one applies to every package, including " +
                "the ones the direction rules leave unrestricted.",
            from: {},
            to: { circular: true },
        },
        {
            name: "core-imports-no-internal-package",
            severity: "error",
            comment:
                "core is the bottom of the stack: pure logic, no workspace neighbours. Its TESTS " +
                "may still reach the testkit, which is why testkit is absent from this list and " +
                "owns its own rule below.",
            from: { path: `${P}core/(?:src|test)/` },
            to: { path: [`${P}(?:capabilities|checks|lab)/`, "^packages/runtime/"] },
        },
        {
            name: "core-and-capabilities-stay-pure",
            severity: "error",
            comment:
                "core's central claim is that decide() does no I/O, and capabilities live behind the " +
                "same boundary: externals arrive as data and lookups, never as sockets, files " +
                "or timers. The claim rested on review alone; this rule mechanizes it. " +
                "node:crypto is the one argued exception (HMAC verification and content-hash " +
                "revisions, argued in-file at both import sites).",
            from: { path: `${P}(?:core|capabilities)/src/` },
            to: {
                dependencyTypes: ["core"],
                pathNot: "^(?:node:)?crypto$",
            },
        },
        {
            name: "store-imports-core-only",
            severity: "error",
            comment: "The owned operational store sits directly on core and on nothing else.",
            from: { path: R("store") },
            to: { path: [`${P}(?:capabilities|checks|lab)/`, R("shell")] },
        },
        {
            name: "adapter-imports-core-only",
            severity: "error",
            comment:
                "The adapter is the only place that talks to GitHub, and it sits directly on " +
                "core. Nothing downstream of core belongs in the one place that holds " +
                "credentials.",
            from: { path: R("adapter") },
            to: { path: [`${P}(?:capabilities|checks|lab)/`, R("store|shell")] },
        },
        {
            name: "shell-imports-core-store-capabilities-adapter",
            severity: "error",
            comment:
                "The transport shell composes core, store, capabilities and the adapter. D93 owns " +
                "shell -> capabilities: the shell decides nothing, so composing the capabilities " +
                "is a legitimate runtime edge rather than a leak.",
            from: { path: R("shell") },
            to: { path: `${P}(?:checks|lab)/` },
        },
        {
            name: "adapter-imported-at-shell-main-only",
            severity: "error",
            comment:
                "GitHub credentials enter at the runnable composition root: the start, and the " +
                "live fill it builds. Not the record they read, which is pure; not another " +
                "directory of the runtime; and no other package. The " +
                "runtime's own `src/index.ts` is absent from the FROM side because it is the " +
                "package's public surface rather than a consumer of the adapter: it re-exports " +
                "three barrels and reaches into none of them. The sweep's test directory is the " +
                "one other exemption: the sweep is the seam between the shell and the adapter, so " +
                "its test needs the adapter's real reader and the fake it answers with, and it " +
                "takes both through the barrel the way the composition root does.",
            from: {
                path: [
                    `${P}(?:core|capabilities|checks|lab|testkit)/(?:src|test)/`,
                    R("store|shell"),
                ],
                pathNot: [
                    "^packages/runtime/src/shell/compose/(?:live|main)\\.ts$",
                    "^packages/runtime/test/shell/sweep/",
                ],
            },
            to: { path: R("adapter") },
        },
        {
            name: "testkit-imports-no-internal-package",
            severity: "error",
            comment:
                "The testkit is a leaf on purpose. A config or declaration builder here would " +
                "need core, and core's tests need the testkit — the cycle this rule refuses in " +
                "advance.",
            from: { path: `${P}testkit/(?:src|test)/` },
            to: { path: [`${P}(?:core|capabilities|checks|lab)/`, "^packages/runtime/"] },
        },
        {
            name: "production-imports-no-checks-or-lab",
            severity: "error",
            comment:
                "checks is tests about the repository and lab is an instrument pointed at " +
                "GitHub. Neither ships, so nothing that ships may reach them — stated separately " +
                "from the layer directions because it survives any future reordering of them.",
            from: { path: [`${P}core/`, "^packages/runtime/"] },
            to: { path: `${P}(?:checks|lab)/` },
        },
        {
            name: "testkit-is-test-only",
            severity: "error",
            comment:
                "The testkit is importable from a test path and nowhere else. 'Who may depend on " +
                "it' is not the question — every package's tests may — so this reads the " +
                "IMPORTER's directory rather than the layer table. The lab's src/ is the one " +
                "other reader: an instrument pointed at GitHub that ships nothing and holds the " +
                "Action to the same journeys table the runtime's matrices hold the shell to.",
            from: { path: `${P}(?!testkit/|lab/)[^/]+/src/` },
            to: { path: `${P}testkit/` },
        },
        {
            name: "no-import-past-the-barrel",
            severity: "error",
            comment:
                "A barrel is the boundary. Reaching a module THROUGH one is fine; reaching past " +
                "it — a named subpath, or a relative path that climbs out of one barrel's " +
                "territory and down into another — is not. `$1` is the importing package's full " +
                "directory (including a `dev/` segment when it has one) and `$2` is the runtime " +
                "directory it sits in, if any, so a territory's own internals stay reachable " +
                "from itself and `dev/` neighbours stay distinct. The runtime's store, shell and " +
                "adapter kept their barrels when they stopped being packages (G4): " +
                "`src/shell/x.ts` may import `../store/index.js` and never `../store/store.js`, " +
                "and only the runtime's own files may name those inner barrels at all — from " +
                "outside, the package's export is `src/index.ts`.",
            from: { path: "^packages/((?:dev/)?[^/]+)/(?:(?:src|test)/(store|shell|adapter)/)?" },
            to: {
                path: `${P}[^/]+/src/`,
                pathNot: [
                    "^packages/$1/(?!src/(?:store|shell|adapter)/)",
                    "^packages/$1/(?:src|test)/$2/",
                    `${P}[^/]+/src/index\\.ts$`,
                    "^packages/$1/src/(?:store|shell|adapter)/index\\.ts$",
                    // core's two named doors, the ones its exports map names.
                    `${P}core/src/author/(?:index|testing)\\.ts$`,
                ],
            },
        },
        {
            name: "harness-is-test-only",
            severity: "error",
            comment:
                "core's `author/testing` is the fixture harness: record and configuration " +
                "builders for a capability's own tests. It is reachable from a test file and " +
                "nowhere else, whichever package the test belongs to.",
            from: { path: `${P}[^/]+/src/`, pathNot: "\\.test\\.ts$" },
            to: { path: `${P}core/src/author/testing\\.ts$` },
        },
        {
            name: "capabilities-enter-by-the-author-door",
            severity: "error",
            comment:
                "A capability names core through `author/`, the door sized to what an author " +
                "needs, never through the root barrel that also exposes the engine, the write " +
                "rules and the report. Its tests may still reach the root, because they drive " +
                "the engine, and so may the registry, `src/index.ts`, which hands the folders to it.",
            from: {
                path: `${P}capabilities/src/`,
                pathNot: ["\\.test\\.ts$", `${P}capabilities/src/index\\.ts$`],
            },
            to: { path: `${P}core/src/index\\.ts$` },
        },
        {
            name: "not-to-unresolvable",
            severity: "error",
            comment:
                "The other half of the rule above, and the reason it is not decoration: a named " +
                "subpath like `@hiero-hackers/automation-core/private` never resolves at all, " +
                "because an exports map names only what it exposes — '.' everywhere, plus core's " +
                "two author doors. Without this rule such " +
                "an import produces no edge and therefore no violation — silence where the " +
                "loudest possible error belongs.",
            from: {},
            to: { couldNotResolve: true },
        },
    ],
    options: {
        // node_modules is followed only far enough to land on the workspace
        // symlink targets, which resolve back into `packages/` and are the
        // whole point of the rules above.
        doNotFollow: { path: "node_modules" },
        exclude: {
            path: [
                "/node_modules/",
                // Stryker sandboxes hold a full copy of a package's src/ and
                // test/ under a path that still starts with `packages/`.
                // Cruising them would double every module and report every
                // rule twice against files nobody edits.
                "\\.stryker-tmp",
                // The gate's own negative control: a tree of deliberate
                // violations, cruised separately and on purpose.
                "^packages/dev/checks/test/fixtures/",
            ],
        },
        // The old scanner counted `import type` as an edge, and it was right
        // to: a type-only import is still one package knowing another's
        // shape. Without this, erasable imports would leave the graph.
        tsPreCompilationDeps: true,
        enhancedResolveOptions: {
            // dependency-cruiser defaults `exportsFields` to `[]` — it
            // ignores exports maps for backwards compatibility. Every package
            // here declares `exports` and no `main`, so with the default
            // every workspace import resolves to nothing, and the rule that
            // treats non-resolution as an error would report the whole
            // workspace rather than the one subpath it is there to catch.
            exportsFields: ["exports"],
            conditionNames: ["import", "require", "node", "types", "default"],
        },
    },
};
