/**
 * One grant stated twice: the permission core's operation declares, and the
 * grant the endpoint its transport reaches carries (D62). The endpoint comes
 * from the request each verb builds, never from the verb's name, and the
 * surface the adapter hands out is those same transports composed.
 * One invariant per `it` (D89).
 */

import {
    INTENT_OPERATIONS,
    type IntentOperation,
    type ItemRef,
    type PermissionGrant,
    type WriteResult,
    type WriteVerbs,
} from "@hiero-hackers/automation-core";
import { describe, expect, it } from "vitest";
import type { GitHubWriteRequest } from "../../../src/adapter/client/contract.js";
import {
    CONFIRMED_WRITE_ENDPOINTS,
    writeEndpointOf,
    type WriteEndpoint,
} from "../../../src/adapter/client/endpoints.js";
import { TRANSPORTS, writeVerbsOf } from "../../../src/adapter/writes/operations/index.js";
import type { VerbContext } from "../../../src/adapter/writes/operations/transport.js";
import { TEST_ITEM as ITEM, TEST_REPOSITORY as REPOSITORY } from "../harness.js";

/** The close names the pull surface, whose grant is not the issue surface's. */
const PULL: ItemRef = { kind: "pullRequest", number: 205 };

/** One call per verb; the arguments are not the subject, the endpoint reached is. */
const CALLS: { readonly [K in keyof WriteVerbs]: (verbs: WriteVerbs) => Promise<WriteResult> } = {
    createLabel: (verbs) => verbs.createLabel("status: stale", "5319e7", "waiting"),
    addLabel: (verbs) => verbs.addLabel(ITEM, "status: stale"),
    removeLabel: (verbs) => verbs.removeLabel(ITEM, "status: stale"),
    createComment: (verbs) => verbs.createComment(ITEM, "hello"),
    updateComment: (verbs) => verbs.updateComment(7788, "again"),
    closePullRequest: (verbs) => verbs.closePullRequest(PULL),
    releaseAssignment: (verbs) => verbs.releaseAssignment(ITEM, "alice"),
    lockIssue: (verbs) => verbs.lockIssue(ITEM),
    unlockIssue: (verbs) => verbs.unlockIssue(ITEM),
};

/** One request an operation built, and the endpoint the client matches it as. */
interface Reach {
    readonly operation: IntentOperation;
    readonly request: string;
    readonly endpoint: WriteEndpoint | null;
}

/** A context that sends nothing, recording the requests the verbs build. */
const recording = (built: GitHubWriteRequest[]): VerbContext => ({
    repository: REPOSITORY,
    apply: (request) => {
        built.push(request);
        return Promise.resolve({ outcome: "applied" });
    },
});

/** Every write the transports build, driven through a context that sends nothing. */
async function reaches(): Promise<Reach[]> {
    const rows: Reach[] = [];
    for (const operation of Object.keys(TRANSPORTS) as IntentOperation[]) {
        const built: GitHubWriteRequest[] = [];
        const context = recording(built);
        const verbs = TRANSPORTS[operation].verbs(context) as WriteVerbs;
        for (const name of Object.keys(verbs) as Array<keyof WriteVerbs>) {
            await CALLS[name](verbs);
        }
        rows.push(
            ...built.map((request) => ({
                operation,
                request: `${request.method} ${request.url}`,
                endpoint: writeEndpointOf(request.method, new URL(request.url))?.endpoint ?? null,
            })),
        );
    }
    return rows;
}

/** The grants the endpoint table states, the side under test. */
const stated = (endpoint: WriteEndpoint): PermissionGrant =>
    CONFIRMED_WRITE_ENDPOINTS[endpoint].grant;

/** Where an endpoint's grant and its operation's permission disagree. */
function disagreements(
    rows: readonly Reach[],
    grantOf: (endpoint: WriteEndpoint) => PermissionGrant,
): string[] {
    return rows
        .filter(
            (row) =>
                row.endpoint !== null &&
                grantOf(row.endpoint) !== INTENT_OPERATIONS[row.operation].permission,
        )
        .map((row) => `${row.operation} → ${String(row.endpoint)}`);
}

describe("a write operation and its endpoint state one permission", () => {
    it("matches every request a transport builds to a confirmed endpoint", async () => {
        const rows = await reaches();

        expect(rows.filter((row) => row.endpoint === null).map((row) => row.request)).toEqual([]);
    });

    it("reaches every confirmed write endpoint", async () => {
        // A transport that stopped building leaves the grant check below vacuous.
        const rows = await reaches();

        expect([...new Set(rows.map((row) => row.endpoint))].sort()).toEqual(
            Object.keys(CONFIRMED_WRITE_ENDPOINTS).sort(),
        );
    });

    it("gives each endpoint the permission its operation states (D62)", async () => {
        expect(disagreements(await reaches(), stated)).toEqual([]);
    });

    it("catches an endpoint whose grant drifted from its operation's", async () => {
        const drifted = (endpoint: WriteEndpoint): PermissionGrant =>
            endpoint === "closePullRequest" ? "issues:write" : stated(endpoint);

        expect(disagreements(await reaches(), drifted)).toEqual([
            "closePullRequest → closePullRequest",
        ]);
    });
});

describe("the write surface is the transports' verbs", () => {
    /** A transport left out of the composition is a verb nothing can send. */
    it("gives the surface every verb a transport contributes", () => {
        const context = recording([]);
        const contributed = Object.values(TRANSPORTS).flatMap((transport) =>
            Object.keys(transport.verbs(context)),
        );

        expect(Object.keys(writeVerbsOf(context)).sort()).toEqual(contributed.sort());
    });
});
