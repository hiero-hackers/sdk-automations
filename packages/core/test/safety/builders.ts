/**
 * The request, configuration and context every safety suite starts from.
 *
 * Three files hold the safety layer to account — the general gate, the
 * destructive gate, and the rule list both run — and all three open on the
 * same well-formed write: an assignment nobody has objected to, in a
 * repository that enabled it, with the permission granted. A test then states
 * only the one fact it is about, which is the fact a reader is looking for.
 *
 * In-package rather than in the testkit, for the reason `config/builders.ts`
 * records: Stryker's sandbox is the mutated package's own directory, so
 * support that lives here is support that survives mutation (D82).
 */

import { evaluateWrite, type WriteContext, type WriteRequest } from "../../src/safety/index.js";
import type { RepositoryConfig } from "../../src/config/index.js";
import { assertedWorld } from "../../src/safety/world.js";

/** A reversible write with nothing wrong with it, ready for one override. */
export const request = (over?: Partial<WriteRequest>): WriteRequest => ({
    actionClass: "reversibleStateChange",
    capability: "assignment",
    requiredPermissions: ["issues:write"],
    causeObservedAt: new Date("2026-07-01T00:00:00Z"),
    cause: "contributor requested /assign",
    target: { item: "issue #42", change: "add label 'status: in progress'" },
    ...over,
});

/**
 * The reviewed configuration is the ONLY source of mode and enablement (D73).
 * A test wanting a disabled capability or a dry-run repository says so here,
 * where a maintainer would.
 */
export const config = (over?: Partial<RepositoryConfig>): RepositoryConfig => ({
    revision: "rev-test",
    schemaVersion: 2,
    mode: "active",
    capabilities: {
        assignment: { enabled: true, settings: {} },
        inactivity: { enabled: true, settings: {} },
        triageQueue: { enabled: true, settings: {} },
    },
    mappings: { labels: {}, commands: {}, skills: {}, alerts: {} },
    principals: {},
    ...over,
});

/** An active repository that enabled the named capability and nothing else. */
export const anyCapability = (name: string) =>
    config({ capabilities: { [name]: { enabled: true, settings: {} } } });

/** Assignment declared and refused — adoption without consent. */
export const capabilityOff = config({
    capabilities: { assignment: { enabled: false, settings: {} } },
});

/** The world as core rechecked it: granted, unpaused, no human conflict. */
export const context = (over?: Partial<WriteContext>): WriteContext => ({
    installationGrants: ["issues:write"],
    killSwitchActive: false,
    latestHumanChangeAt: null,
    world: assertedWorld([], true),
    ...over,
});

/** Config last so the existing call shape stays readable. */
export const evalWrite = (r: WriteRequest, c: WriteContext, cfg: RepositoryConfig = config()) =>
    evaluateWrite(r, cfg, c);
