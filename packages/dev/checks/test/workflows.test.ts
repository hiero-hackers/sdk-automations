/**
 * The four security claims the workflow comments make, as checks: actions
 * SHA-pinned with version comments, no `pull_request_target`, permissions
 * read-only outside an explicit allowlist, and no checkout persisting the
 * token. The whole directory is read, because this class regresses through a
 * NEW job that quietly omits the hardening rather than through a removal (D100).
 * The conformance workflow's credential boundary — its probe read-only, its
 * publisher secret-free — is held in the second describe below.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { lines, repoRoot, repositoryFiles } from "./repository.js";

const workflows = repositoryFiles().filter(
    (path) => path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path),
);

/**
 * The write grants that legitimately exist, as `<path>:<scope>` for a
 * workflow-level block or `<path>:<job>:<scope>` for a job's own. A workflow
 * that needs one must add its entry here visibly, rather than weaken the
 * check — and because a job grant names its job, a write added to a DIFFERENT
 * job of an already-listed workflow fails rather than hiding under the
 * workflow's entry.
 */
const WRITE_ALLOWLIST = new Set([
    ".github/workflows/scorecard.yml:analysis:security-events",
    ".github/workflows/scorecard.yml:analysis:id-token",
    // CodeQL's SARIF upload, declared on the analyze job only so no other
    // step can inherit it (D101, #42).
    ".github/workflows/codeql.yml:analyze:security-events",
    // The conformance stamp travels by pull request, and only the publishing
    // job may carry those writes — the credentialed probe stays read-only (D158).
    ".github/workflows/conformance.yml:publish:contents",
    ".github/workflows/conformance.yml:publish:pull-requests",
    // The release image is pushed and attested by the one publishing job; the
    // tag push that triggers it is read-only everywhere else.
    ".github/workflows/release.yml:image:packages",
    ".github/workflows/release.yml:image:id-token",
    ".github/workflows/release.yml:image:attestations",
]);

function workflowText(path: string): string {
    return readFileSync(join(repoRoot, path), "utf8");
}

function workflowLines(path: string): string[] {
    return lines(workflowText(path));
}

/** A `permissions:` value, in every shape the Actions schema allows. */
type PermissionBlock = string | Readonly<Record<string, unknown>> | null | undefined;

/** A step, in the two parts these checks ask about: what it runs, and its inputs. */
interface WorkflowStep {
    readonly uses?: unknown;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly run?: unknown;
    readonly if?: unknown;
}

interface WorkflowJob {
    readonly permissions?: PermissionBlock;
    readonly needs?: unknown;
    readonly if?: unknown;
    readonly outputs?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly (WorkflowStep | null)[] | null;
}

interface WorkflowDocument {
    readonly on?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly permissions?: PermissionBlock;
    readonly concurrency?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, WorkflowJob | null>>;
}

/** A workflow as the Actions schema describes it, or nothing if it is not a mapping. */
function workflowDocument(text: string): WorkflowDocument | null {
    const document = parse(text) as WorkflowDocument | null;
    return document !== null && typeof document === "object" ? document : null;
}

/** Every step of every job, flattened — the level both step checks work at. */
function steps(text: string): WorkflowStep[] {
    return Object.values(workflowDocument(text)?.jobs ?? {}).flatMap((job) =>
        [...(job?.steps ?? [])].filter(
            (step): step is WorkflowStep => step !== null && typeof step === "object",
        ),
    );
}

/** What each step runs. A step without `uses:` runs `run:` and is not an action. */
function actionRefs(text: string): string[] {
    return steps(text)
        .map((step) => step.uses)
        .filter((uses): uses is string => typeof uses === "string");
}

/**
 * The checkouts that leave the token behind, as `<path>: <ref>`.
 *
 * Parsed, never scanned line by line, for the reason `permissionWrites` is:
 * the forward line scan this replaced read a COMMENTED-OUT flag as the flag
 * being set, missed the quoted `'false'` the action honours, and never saw a
 * step written as a flow mapping, where the setting shares the `uses:` line.
 * Actions inputs cross the wire as strings, so `false` and `'false'` are the
 * same instruction to the action, and both drop the token.
 */
function persistingCheckouts(path: string, text: string): string[] {
    const persisting: string[] = [];
    for (const step of steps(text)) {
        if (typeof step.uses !== "string" || !step.uses.startsWith("actions/checkout@")) continue;
        const flag = step.with?.["persist-credentials"];
        if (flag !== false && flag !== "false") persisting.push(`${path}: ${step.uses}`);
    }
    return persisting;
}

/**
 * The writes one block grants, as `<path>:<scope>`.
 *
 * `write-all` reports under that name rather than expanding to every scope:
 * it is a different decision from granting one scope, and no allowlist entry
 * naming a scope should ever match it.
 */
function writesIn(path: string, block: PermissionBlock): string[] {
    if (block === null || block === undefined) return [];
    if (typeof block === "string") return block === "write-all" ? [`${path}:write-all`] : [];
    return Object.entries(block)
        .filter(([, level]) => level === "write")
        .map(([scope]) => `${path}:${scope}`);
}

/**
 * Parsed, never scanned line by line. A regex reading `permissions:` off its
 * own line is blind to a flow mapping, a quoted `"write"`, and the
 * `write-all` shorthand — three legal spellings of the grant this check
 * exists to refuse, each of which passed silently. Same argument, same
 * parser, as `mutation-coverage.test.ts` reading `ci.yml`.
 *
 * Both levels the schema permits: the workflow's own block, and each job's.
 * A job's grant is keyed by its job's name, so the allowlist answers WHICH
 * job holds a write, not merely which file.
 */
function permissionWrites(path: string, text: string): string[] {
    const document = workflowDocument(text);
    if (document === null) return [];
    const jobs = Object.entries(document.jobs ?? {});
    return [
        ...writesIn(path, document.permissions),
        ...jobs.flatMap(([name, job]) => writesIn(`${path}:${name}`, job?.permissions)),
    ];
}

const CANCEL_PULL_REQUESTS_ONLY = "${{ github.event_name == 'pull_request' }}";

/** True only when ci.yml cancels in-flight runs for pull requests alone. */
function cancelsOnlyPullRequests(ci: unknown): boolean {
    const document = ci as WorkflowDocument | null;
    return document?.concurrency?.["cancel-in-progress"] === CANCEL_PULL_REQUESTS_ONLY;
}

/** True only when ci.yml's audit job runs on a push alone. */
function auditsOnPushOnly(ci: unknown): boolean {
    const document = ci as WorkflowDocument | null;
    return document?.jobs?.["audit"]?.if === "github.event_name == 'push'";
}

describe("workflow hygiene stays a checked invariant", () => {
    it("reads every workflow file", () => {
        expect(workflows.length).toBeGreaterThan(0);
    });

    /**
     * The ref comes from the parser, not from a `uses:` substring test: that
     * test also fires on a comment that happens to contain the word and on a
     * local `./.github/actions/…` composite, neither of which can carry a SHA.
     * A local action moves with this repository, so pinning it names nothing.
     */
    it("pins every third-party action to a full commit SHA", () => {
        for (const path of workflows) {
            for (const ref of actionRefs(workflowText(path))) {
                if (ref.startsWith("./")) continue;
                expect(ref.split("@").at(-1), `${path}: ${ref}`).toMatch(/^[0-9a-f]{40}$/);
            }
        }
    });

    /**
     * A SHA nobody can read is a SHA nobody updates, so each pin names the
     * version it stands for. Comments do not survive parsing, so this half
     * stays textual — with the line match ANCHORED to a step's `uses:` key,
     * which is what the substring test above it was standing in for.
     */
    it("names the version behind every pin, in a comment", () => {
        for (const path of workflows) {
            for (const line of workflowLines(path)) {
                if (!/^\s*(?:-\s+)?uses:\s/.test(line)) continue;
                if (/^\s*(?:-\s+)?uses:\s+\.\//.test(line)) continue;
                expect(line, `${path}: ${line}`).toMatch(/^\s*(?:-\s+)?uses:\s+\S+\s+#\s*v.+$/);
            }
        }
    });

    it("never uses pull_request_target", () => {
        for (const path of workflows) {
            expect(
                workflowLines(path).join("\n"),
                `${path} must not contain pull_request_target`,
            ).not.toContain("pull_request_target");
        }
    });

    it("keeps permissions read-only outside the explicit write allowlist", () => {
        const actual = workflows.flatMap((path) => permissionWrites(path, workflowText(path)));
        expect([...actual].sort()).toEqual([...WRITE_ALLOWLIST].sort());
    });

    /**
     * Without the flag the token is written into `.git/config` and stays
     * readable to every later step. `ci.yml` claims every checkout sets it,
     * and a claim in this repository becomes an invariant (D100).
     */
    it("never persists the token past checkout", () => {
        const persisting = workflows.flatMap((path) =>
            persistingCheckouts(path, workflowText(path)),
        );
        expect(persisting).toEqual([]);
    });

    it("proves the pin check can fail in both directions", () => {
        const pin = (ref: string): boolean => /^[0-9a-f]{40}$/.test(ref);
        expect(pin("v4")).toBe(false);
        expect(pin("3d3c42e5aac5ba805825da76410c181273ba90b1")).toBe(true);
    });

    it("never cancels a push to main in flight", () => {
        expect(cancelsOnlyPullRequests(parse(workflowText(".github/workflows/ci.yml")))).toBe(true);
    });

    it("audits dependencies on a push only", () => {
        expect(auditsOnPushOnly(parse(workflowText(".github/workflows/ci.yml")))).toBe(true);
    });

    it("proves the cancellation and audit checks can fail", () => {
        const cancel = (value: unknown): unknown => ({
            concurrency: { "cancel-in-progress": value },
        });
        expect(cancelsOnlyPullRequests(cancel(true))).toBe(false);
        expect(cancelsOnlyPullRequests({ concurrency: {} })).toBe(false);
        expect(cancelsOnlyPullRequests(cancel("${{ github.event_name == 'pull_requests' }}"))).toBe(
            false,
        );
        expect(cancelsOnlyPullRequests(cancel(CANCEL_PULL_REQUESTS_ONLY))).toBe(true);
        const audit = (value: unknown): unknown => ({ jobs: { audit: { if: value } } });
        expect(auditsOnPushOnly(audit(true))).toBe(false);
        expect(auditsOnPushOnly({ jobs: { audit: {} } })).toBe(false);
        expect(auditsOnPushOnly(audit("github.event_name == 'pushes'"))).toBe(false);
        expect(auditsOnPushOnly(audit("github.event_name == 'push'"))).toBe(true);
    });

    const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
    const checkoutStep = (step: string): string => `jobs:\n  a:\n    steps:\n      ${step}\n`;

    /**
     * Every row is valid YAML that drops the token, and the last two were read
     * as PERSISTING by the forward line scan this replaced: the quoted value
     * missed its regex, and a flow-mapped step keeps the setting on the same
     * line as `uses:`, ahead of where the scan started looking.
     */
    it.each([
        [
            "an unquoted false",
            `- uses: ${CHECKOUT}\n        with:\n          persist-credentials: false`,
        ],
        [
            "a quoted false",
            `- uses: ${CHECKOUT}\n        with:\n          persist-credentials: "false"`,
        ],
        ["a flow-mapped step", `- { uses: ${CHECKOUT}, with: { persist-credentials: false } }`],
    ] as const)("accepts a checkout that drops the token via %s", (_name, step) => {
        expect(persistingCheckouts("w", checkoutStep(step))).toEqual([]);
    });

    /**
     * The other direction, including the one that made the scan report a PASS:
     * a commented-out flag satisfied an unanchored search of the step's lines.
     */
    it.each([
        ["no with: block", `- uses: ${CHECKOUT}`],
        [
            "the flag commented out",
            `- uses: ${CHECKOUT}\n        with:\n          # persist-credentials: false\n          fetch-depth: 0`,
        ],
        [
            "the flag set to true",
            `- uses: ${CHECKOUT}\n        with:\n          persist-credentials: true`,
        ],
    ] as const)("reports a checkout with %s", (_name, step) => {
        expect(persistingCheckouts("w", checkoutStep(step))).toEqual([`w: ${CHECKOUT}`]);
    });

    /**
     * The allowlist comparison guards the workflows that exist; this guards
     * the check itself against the way it regresses — a NEW job whose grant
     * is spelt in a shape the reader never learned. Every row below is valid
     * YAML that GitHub honours, and the first three were invisible to the
     * line scanner this replaced. The last two hold the job-scoped keys: a
     * write must name its job, and a read-only job beside a writing one must
     * not be swept into its neighbour's grant.
     */
    it.each([
        [
            "a block mapping",
            "jobs:\n  a:\n    permissions:\n      contents: write\n",
            ["w:a:contents"],
        ],
        ["a flow mapping", "jobs:\n  a:\n    permissions: { contents: write }\n", ["w:a:contents"]],
        ["a quoted value", 'permissions:\n  contents: "write"\n', ["w:contents"]],
        ["the write-all shorthand", "permissions: write-all\n", ["w:write-all"]],
        ["a workflow-level block", "permissions:\n  contents: write\n", ["w:contents"]],
        [
            "one writing job beside a read-only one",
            "jobs:\n  a:\n    permissions:\n      contents: write\n  b:\n    permissions:\n      contents: read\n",
            ["w:a:contents"],
        ],
        [
            "the same write moved to the other job",
            "jobs:\n  a:\n    permissions:\n      contents: read\n  b:\n    permissions:\n      contents: write\n",
            ["w:b:contents"],
        ],
    ] as const)("finds the write granted by %s", (_name, yaml, expected) => {
        expect(permissionWrites("w", yaml)).toEqual(expected);
    });

    it.each([
        ["read", "permissions:\n  contents: read\n"],
        ["none", "permissions:\n  contents: none\n"],
        ["read-all", "permissions: read-all\n"],
        ["an empty block", "permissions: {}\n"],
        ["no permissions key at all", "jobs:\n  a:\n    runs-on: ubuntu-latest\n"],
    ] as const)("reports no write for %s", (_name, yaml) => {
        expect(permissionWrites("w", yaml)).toEqual([]);
    });
});

describe("the conformance workflow keeps its credential boundary", () => {
    const path = ".github/workflows/conformance.yml";
    const document = workflowDocument(workflowText(path));
    const probe = document?.jobs?.["probe"];
    const publish = document?.jobs?.["publish"];

    /** The job's steps as a mapping, dropping nulls the schema allows. */
    function stepsOf(job: WorkflowJob | null | undefined): WorkflowStep[] {
        return [...(job?.steps ?? [])].filter(
            (step): step is WorkflowStep => step !== null && typeof step === "object",
        );
    }

    /** Every step using the named action, e.g. `actions/upload-artifact`. */
    function actionSteps(job: WorkflowJob | null | undefined, action: string): WorkflowStep[] {
        return stepsOf(job).filter(
            (step) => typeof step.uses === "string" && step.uses.startsWith(`${action}@`),
        );
    }

    /** Every `run:` script the job holds, joined — the level a path check reads. */
    function scriptOf(job: WorkflowJob | null | undefined): string {
        return stepsOf(job)
            .map((step) => (typeof step.run === "string" ? step.run : ""))
            .join("\n");
    }

    /**
     * The jobs a `needs:` names, in both shapes the schema allows. The shape
     * is not the claim — that the publisher names the probe is.
     */
    function needsOf(job: WorkflowJob | null | undefined): string[] {
        const held = job?.needs;
        return typeof held === "string"
            ? [held]
            : Array.isArray(held)
              ? held.filter((name): name is string => typeof name === "string")
              : [];
    }

    /** The `on:` block's trigger names, or the single trigger a bare string is. */
    function triggersOf(): string[] {
        const on = document?.on;
        return typeof on === "string"
            ? [on]
            : on !== null && typeof on === "object"
              ? Object.keys(on as Record<string, unknown>)
              : [];
    }

    it("splits the credentialed probe from the publisher", () => {
        expect(stepsOf(probe).length, "a probe job with steps").toBeGreaterThan(0);
        expect(stepsOf(publish).length, "a publish job with steps").toBeGreaterThan(0);
    });

    /**
     * The probe holds the sandbox App's key, so it must hold no repository
     * write: a compromised probe step must not be able to push to this
     * repository with its own token.
     */
    it("keeps the probe job read-only", () => {
        expect(writesIn(path, probe?.permissions)).toEqual([]);
    });

    /** Exact: the publisher may carry the two writes the stamp needs and no third. */
    it("gives the publisher exactly the two writes the stamp needs", () => {
        expect(publish?.permissions).toEqual({
            contents: "write",
            "pull-requests": "write",
        });
    });

    /**
     * The publisher holds the repository's write token, so it must hold no
     * secret of the sandbox App — neither in its own mapping nor in a
     * workflow-level `env:`, which every job inherits. Parsed, so a comment
     * naming secrets cannot false-positive, and every legal reference — a
     * step's `env:`, an action's `with:`, a reusable call's `secrets:` —
     * survives as a string inside the serialized mapping.
     */
    it("keeps every secret out of the publisher", () => {
        expect(JSON.stringify(publish) ?? "").not.toContain("secrets.");
        expect(JSON.stringify(document?.env ?? {})).not.toContain("secrets.");
    });

    /**
     * The one privileged workflow: no `pull_request` in any form may reach
     * it, or fork code runs one step away from the write token. The other
     * workflows' triggers are not this test's claim.
     */
    it("triggers only by schedule or manual dispatch", () => {
        expect(new Set(triggersOf())).toEqual(new Set(["workflow_dispatch", "schedule"]));
    });

    /**
     * A `needs:` gate skips a job whose need failed, and a credential-less
     * probe writes no stamp so its output stays false — so both a failed
     * probe and an uncredentialed one stop here, before any branch is
     * moved. The `if` is exact on purpose: `always()` or a looser condition
     * is precisely the regression this exists to refuse.
     */
    it("publishes only after the probe's own verdict", () => {
        expect(needsOf(publish)).toContain("probe");
        expect(publish?.if).toBe("needs.probe.outputs.changed == 'true'");
    });

    /**
     * Only the expected result file may cross the boundary: ONE artifact,
     * one file, taken only when the stamp moved. A second upload — of the
     * evidence log, or of RUNNER_TEMP, where the key lives — is exactly the
     * shape this exists to refuse, so the counts are asserted rather than
     * assumed, and the download path is pinned to the directory the
     * publishing script reads from. The App's key stays on the probe's
     * runner.
     */
    it("crosses only the results file between the jobs", () => {
        const uploads = actionSteps(probe, "actions/upload-artifact");
        const downloads = actionSteps(publish, "actions/download-artifact");
        expect(uploads).toHaveLength(1);
        expect(downloads).toHaveLength(1);
        const [upload] = uploads;
        const [download] = downloads;
        expect(upload?.if).toBe("steps.stamp.outputs.changed == 'true'");
        expect(upload?.with?.["path"]).toBe("packages/dev/lab/probe-results.json");
        expect(download?.with?.["name"]).toBe(upload?.with?.["name"]);
        expect(download?.with?.["path"]).toBe("stamp");
        expect(scriptOf(publish)).toContain("stamp/probe-results.json");
    });

    /**
     * The publishing path itself: the stamp branch moves to main, the commit
     * travels by the contents API with the DCO sign-off GitHub signs for,
     * and a person is still offered the pull request to review.
     */
    it("keeps the publishing path", () => {
        const script = scriptOf(publish);
        expect(script).toContain("git/refs");
        expect(script).toContain("contents/");
        expect(script).toContain("pr create");
        expect(script).toContain("Signed-off-by: github-actions[bot]");
    });
});
