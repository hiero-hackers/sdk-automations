/**
 * The producer registry's own invariants — what has to hold of the table
 * before any producer or any declaration is judged against it.
 *
 * Whether each producer actually reads what its row promises is a question
 * about the producers, not the table, and it is asked generically over this
 * registry in `packages/runtime/test/producers.test.ts` — the one package that
 * can see both the webhook normalizers and the sweep's reader.
 */

import { describe, expect, it } from "vitest";
import {
    carriesFactGroup,
    FACT_GROUPS,
    FACT_KINDS,
    type FactGroup,
    type FactKind,
    type PullRequestFacts,
    type Unread,
} from "../../src/catalogue.js";
import {
    groupsNeeded,
    PRODUCER_NAMES,
    PRODUCERS,
    producerReads,
    producersReading,
    producesKind,
    spec,
    WEBHOOK_PRODUCERS,
    type DeclaredTrigger,
    type DeclaringCapability,
    type ProducedFacts,
} from "../../src/capability/index.js";
import { NO_CONFIG } from "../../src/config/index.js";
import { configEnabling } from "../../src/author/testing.js";

describe("the producer registry", () => {
    it("is the webhook producers and the sweep, each with a row", () => {
        expect([...PRODUCER_NAMES]).toEqual([...WEBHOOK_PRODUCERS, "sweep"]);
        expect(Object.keys(PRODUCERS).sort()).toEqual([...PRODUCER_NAMES].sort());
    });

    /**
     * A row may not promise a group its kind does not carry. `review` on an
     * issue would be a promise no record could keep, and the boot check would
     * admit a declaration the engine could never invoke.
     */
    it("promises only groups the kind carries", () => {
        const impossible: string[] = [];
        for (const producer of PRODUCER_NAMES) {
            for (const kind of FACT_KINDS) {
                if (!producesKind(producer, kind)) continue;
                for (const group of FACT_GROUPS) {
                    if (!producerReads(producer, kind, group)) continue;
                    if (carriesFactGroup(kind, group)) continue;
                    impossible.push(`${producer}/${kind}: ${group}`);
                }
            }
        }
        expect(impossible).toEqual([]);
    });

    /**
     * Every group has a reader, which is what lets the boot refusal always end
     * by naming one. A group added to `FACT_GROUPS` before any producer fills
     * it would be a need nothing could ever answer, and the refusal a
     * capability got back would name nobody to move its trigger to.
     */
    it("leaves no group unread by every producer", () => {
        const orphans: string[] = [];
        for (const kind of FACT_KINDS) {
            for (const group of FACT_GROUPS) {
                if (!carriesFactGroup(kind, group)) continue;
                if (producersReading(kind, group).length > 0) continue;
                orphans.push(`${kind}: ${group}`);
            }
        }
        expect(orphans).toEqual([]);
    });

    it("answers the three questions the boot check asks", () => {
        // The negative control for each: a producer that makes no record of a
        // kind, and a group a producer that does make one still never reads.
        expect(producesKind("issues", "pullRequest")).toBe(false);
        expect(producerReads("issues", "pullRequest", "assignees")).toBe(false);
        expect(producerReads("pull_request", "pullRequest", "review")).toBe(false);
        expect(producerReads("sweep", "pullRequest", "review")).toBe(true);
        expect(producersReading("pullRequest", "review")).toEqual(["sweep"]);
    });
});

const HOURLY: readonly DeclaredTrigger[] = [{ kind: "schedule", description: "hourly" }];

/** One capability, as `groupsNeeded` reads it. */
function declaring(
    name: string,
    needs: readonly FactGroup[],
    facts: readonly FactKind[] = FACT_KINDS,
    triggers: readonly DeclaredTrigger[] = HOURLY,
): DeclaringCapability {
    return { declaration: { name, triggers, facts, needs } };
}

const SHIPPED = [
    declaring("reviews", ["review"]),
    declaring("stale", ["assignees", "links"]),
    declaring("prOnly", ["assignees"], ["pullRequest"]),
    declaring("onComment", ["review"], FACT_KINDS, [{ kind: "event", event: "pull_request" }]),
    declaring("onCommand", ["command"]),
];

const enabling = (...names: readonly string[]) =>
    configEnabling(
        names,
        SHIPPED.map(({ declaration }) => ({
            name: declaration.name,
            settings: spec({}),
            requiredMappings: {},
        })),
    );

describe("the groups a repository's enabled set needs", () => {
    it("is one enabled capability's needs and nobody else's", () => {
        const config = enabling("reviews");

        expect(groupsNeeded(config, SHIPPED, "pullRequest")).toEqual(["review"]);
        expect(groupsNeeded(config, SHIPPED, "issue")).toEqual([]);
    });

    it("is the union of two, in the row's order", () => {
        const config = enabling("reviews", "stale");

        expect(groupsNeeded(config, SHIPPED, "pullRequest")).toEqual([
            "assignees",
            "links",
            "review",
        ]);
        expect(groupsNeeded(config, SHIPPED, "issue")).toEqual(["assignees", "links"]);
    });

    it("takes nothing from a capability with no schedule trigger", () => {
        expect(groupsNeeded(enabling("onComment"), SHIPPED, "pullRequest")).toEqual([]);
    });

    it("takes nothing from a capability the repository has not enabled", () => {
        expect(groupsNeeded(NO_CONFIG, SHIPPED, "pullRequest")).toEqual([]);
        expect(groupsNeeded(enabling(), SHIPPED, "pullRequest")).toEqual([]);
    });

    it("takes nothing from a capability that makes no record of this kind", () => {
        expect(groupsNeeded(enabling("prOnly"), SHIPPED, "issue")).toEqual([]);
        expect(groupsNeeded(enabling("prOnly"), SHIPPED, "pullRequest")).toEqual(["assignees"]);
    });

    /**
     * `command` is carried by an issue and read by `issue_comment` alone, so
     * the boot check refuses this declaration. The intersection is the second
     * guard: a group the sweep does not read is never asked for.
     */
    it("never returns a group the sweep's own row does not read", () => {
        expect(groupsNeeded(enabling("onCommand"), SHIPPED, "issue")).toEqual([]);
    });
});

/** Equality both ways, so a branch widened on either side fails rather than passes. */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Delivered = ProducedFacts<"pull_request", "pullRequest">;

describe("the record shape a row types", () => {
    it("excludes the unread branch from a group the row reads", () => {
        const reads: Exactly<
            Delivered["readiness"],
            Exclude<PullRequestFacts["readiness"], Unread>
        > = true;
        expect(reads).toBe(true);
    });

    it("leaves a group the row omits unread", () => {
        const omits: Exactly<Delivered["review"], Unread> = true;
        expect(omits).toBe(true);
    });
});
