/**
 * What each seed asks its repository for, and what the platform does with an
 * answer it cannot read.
 *
 * The specs here are the SEEDS' — the keys each one reads today, not the ones
 * its `design.md` describes. The designs' own config sections are pinned
 * against the toolkit in core, beside the toolkit they prove.
 *
 * The claim worth a shared suite is the one all three now share: a settings
 * block the capability could not read never reaches it, because the parser
 * read it first. So the rejections below are `parseConfig`'s, at the path in
 * the maintainer's own file, and the capability's `evaluate` has no settings
 * caption left to fail in.
 */

import { describe, expect, it } from "vitest";
import {
    EngineHandle,
    parseConfig,
    projectCapabilityView,
    type Facts,
    type PlatformHandle,
    type ResolverSource,
    type StructuredExplanation,
    type TypedDeclaration,
} from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "../src/index.js";
import { intake } from "../src/intake/capability.js";
import { inactivity } from "../src/inactivity/capability.js";
import {
    configEnabling,
    sweptIssue,
    webhookIssue,
} from "@hiero-hackers/automation-core/author/testing";

const AT = new Date("2026-09-09T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;

/** The view a repository supplying `settings` hands the named capability. */
const viewFor = <D extends TypedDeclaration>(
    declaration: D,
    settings: Readonly<Record<string, unknown>>,
) =>
    projectCapabilityView(
        declaration,
        configEnabling([declaration.name], [declaration], {
            [declaration.name]: settings,
        }),
    );

/** One capability's block, offered to the parser on its own. */
const parsed = (declaration: TypedDeclaration, settings: Readonly<Record<string, unknown>>) =>
    parseConfig(
        {
            schemaVersion: 2,
            capabilities: { [declaration.name]: { enabled: true, ...settings } },
            mappings: { labels: { awaitingTriage: "status: triage" } },
        },
        { revision: "rev-settings", knownCapabilities: [declaration] },
    );

/**
 * Every row here is about a settings block, so the one resolver any of these
 * capabilities asks answers "a person": a bot record would be another test.
 */
const A_PERSON: ResolverSource = async () => ({ ok: true, value: false }) as never;

/** The engine's own handle over one record, and what a capability said through it. */
function watch<D extends TypedDeclaration>(
    declaration: D,
    facts: Facts,
): {
    readonly platform: PlatformHandle<D>;
    readonly explained: readonly StructuredExplanation[];
} {
    const handle = new EngineHandle(declaration, facts, A_PERSON);
    // The cast the engine makes for real: one loop, many declarations (D92).
    return { platform: handle as unknown as PlatformHandle<D>, explained: handle.explanations };
}

/** intake reads a webhook record; it declares no need, so every group is unread. */
const issue = webhookIssue({ repository: REPO, observedAt: AT });

/** inactivity reads a sweep record: an unread group would be a `factsUnread` skip. */
const swept = sweptIssue({
    repository: REPO,
    observedAt: AT,
    assignees: [
        {
            login: "contributor",
            assignedAt: new Date("2026-07-01T00:00:00.000Z"),
            lastWorkingAt: null,
        },
    ],
});

describe("the seeds' specs", () => {
    it("read the keys their declarations admit, with the defaults they document", () => {
        expect(viewFor(intake.declaration, {}).settings).toEqual({
            announce: false,
            unlockWhen: [],
            confirmUnlock: false,
        });
        expect(viewFor(inactivity.declaration, {}).settings).toEqual({
            exemptBlocked: true,
            // Hours: a duration is written `14d` and resolves to 336.
            remindAfter: 14 * 24,
            // The root's release clock is a section, so it is always read: it
            // is the default every level inherits, never consent of its own.
            reap: { after: 21 * 24 },
            // Both ladders are opt-in, so a repository that states nothing
            // gets a capability with nothing switched on.
            issues: { enabled: false },
            pullRequests: { enabled: false },
        });
    });

    /**
     * D125's removal, still true one layer down: nothing to supply, nothing to
     * read. WHICH seeds answer that way is the registry's to say — the day one
     * of them declares its first key, that is a change to its own folder and
     * its own tests, and this claim is about the ones that still do not.
     */
    it("hand a seed whose spec declares no key nothing at all", () => {
        const names = CAPABILITIES.map(({ declaration }) => declaration.name);
        const declarations = CAPABILITIES.map(({ declaration }) => declaration);
        const keyless = CAPABILITIES.filter(
            ({ declaration }) => Object.keys(declaration.settings).length === 0,
        );
        expect(keyless.length).toBeGreaterThan(0);

        const config = configEnabling(names, declarations);
        for (const { declaration } of keyless) {
            expect(config.capabilities[declaration.name]?.settings, declaration.name).toEqual({});
        }
    });
});

describe("a settings block a seed cannot read", () => {
    /**
     * D38 extended from key names to values (C1). The file is refused whole,
     * with the path a maintainer edits — where the same file used to parse
     * clean and intake reported itself unusable on every delivery it met.
     */
    it("is refused for intake before any delivery reaches it", () => {
        const result = parsed(intake.declaration, { announce: "yes" });

        expect(result.ok ? [] : result.errors).toEqual([
            {
                code: "settingInvalid",
                path: "capabilities.intake.announce",
                message: "capabilities.intake.announce: must be true or false",
            },
        ]);
    });

    it("is refused for inactivity, at the clock that is wrong", () => {
        const result = parsed(inactivity.declaration, { remindAfter: -1 });

        expect(result.ok ? [] : result.errors).toEqual([
            {
                code: "settingInvalid",
                path: "capabilities.inactivity.remindAfter",
                message:
                    'capabilities.inactivity.remindAfter: must be a duration: a whole number of hours or days, written "4h" or "14d"',
            },
        ]);
    });

    /**
     * The rule the toolkit cannot state, and so the one problem still spoken
     * per delivery: a setting that demands a MAPPING. Reaping on
     * `needsRevision` needs the meaning mapped, or the reason could never fire
     * and the repository would never learn why.
     */
    /** Every label meaning has a default spelling (D203), so a reaping reason is never unmapped. */
    it("is not reported by inactivity for a reason the file never spelled: the default stands", async () => {
        const { platform, explained } = watch(inactivity.declaration, swept);
        const defaulted = projectCapabilityView(
            inactivity.declaration,
            configEnabling(
                ["inactivity"],
                [inactivity.declaration],
                {
                    inactivity: {
                        pullRequests: {
                            enabled: true,
                            reapWhen: { needsRevision: { enabled: true } },
                        },
                    },
                },
                { labels: { awaitingTriage: "status: triage" } },
            ),
        );

        expect(await inactivity.evaluate(swept, defaulted, platform)).toEqual([]);
        expect(explained).toEqual([]);
    });

    /**
     * The guard belongs to the reason, not to the capability.
     *
     * A repository that never switched that reason on has nothing to fix, so
     * the unmapped meaning is not its problem and the ladder it DID switch on
     * runs with nothing spoken.
     */
    it("is not reported when the reason that needs the meaning is switched off", async () => {
        const { platform, explained } = watch(inactivity.declaration, swept);
        const issuesOnly = projectCapabilityView(
            inactivity.declaration,
            configEnabling(
                ["inactivity"],
                [inactivity.declaration],
                { inactivity: { issues: { enabled: true } } },
                { labels: { awaitingTriage: "status: triage" } },
            ),
        );

        expect(await inactivity.evaluate(swept, issuesOnly, platform)).toMatchObject([
            { operation: "postManagedComment" },
        ]);
        expect(explained).toEqual([]);
    });

    /**
     * The positive half of the same guard: with the meaning mapped, the
     * capability runs — so the skip above is the rule firing and not the
     * fixture being unreadable for some other reason.
     */
    it("runs once the meaning that reason names is mapped", async () => {
        const { platform, explained } = watch(inactivity.declaration, swept);
        const mapped = projectCapabilityView(
            inactivity.declaration,
            configEnabling(
                ["inactivity"],
                [inactivity.declaration],
                {
                    inactivity: {
                        pullRequests: {
                            enabled: true,
                            reapWhen: { needsRevision: { enabled: true } },
                        },
                    },
                },
                { labels: { needsRevision: "status: needs revision" } },
            ),
        );

        expect(await inactivity.evaluate(swept, mapped, platform)).toEqual([]);
        expect(explained).toEqual([]);
    });

    /** intake still reads the block it was handed, once the file is valid. */
    it("announces when the value the parser accepted says so", async () => {
        const { platform } = watch(intake.declaration, issue);
        const announced = await intake.evaluate(
            issue,
            viewFor(intake.declaration, { announce: true }),
            platform,
        );
        expect(announced.map(({ operation }) => operation)).toEqual([
            "applyMappedLabel",
            "postManagedComment",
        ]);
    });
});
