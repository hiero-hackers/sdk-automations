/**
 * assignment — let a contributor claim work, and release it again (`design.md`): the two
 * commands, claimability and the cap. The words are `messages.ts`.
 */

import {
    declareCapability,
    meaningsOf,
    type Capability,
    type CapabilityView,
    type IntentFor,
    type PlatformHandle,
} from "@hiero-hackers/automation-core/author";
import { alreadyClaimed, atCap, claimed, deniedBy, notYetClaimable, released } from "./messages.js";
import { ASSIGNMENT_SETTINGS } from "./settings.js";

/** No `requiredMappings`: a command word has no default spelling, so the guard below says it instead. */
export const assignmentDeclaration = declareCapability({
    name: "assignment",
    triggers: [{ kind: "event", event: "issue_comment" }],
    needs: ["command"],
    settings: ASSIGNMENT_SETTINGS,
    resolvers: ["isAutomationActor", "assigneesOf", "openAssignments"],
    intents: ["postManagedComment", "assign", "unassign"],
});

export type AssignmentDeclaration = typeof assignmentDeclaration;

type Facts = Parameters<Capability<AssignmentDeclaration>["evaluate"]>[0];
type View = CapabilityView<AssignmentDeclaration>;
type Platform = PlatformHandle<AssignmentDeclaration>;
type Intents = readonly IntentFor<AssignmentDeclaration>[];

/** Each block, and the command word it cannot act without. */
const COMMAND_OF = { autoAssign: "assign", unassign: "unassign" } as const;

/** Every enabled block whose command word is unmapped, at its dotted path in the parser's words. */
function unmappedCommands(view: View): readonly string[] {
    return (Object.keys(COMMAND_OF) as (keyof typeof COMMAND_OF)[])
        .filter((block) => view.settings[block].enabled)
        .filter((block) => !view.mapped.commands.includes(COMMAND_OF[block]))
        .map((block) => {
            const command = COMMAND_OF[block];
            return `capabilities.assignment.${block}.enabled: the ${command} command needs mappings.commands.${command}, and this repository has not mapped it`;
        });
}

/** Each intent's occasion, part of its identity (D65): a claim asked for, or a release. */
const CLAIM = "claimRequested";
const RELEASE = "releaseRequested";

/** GitHub logins are case-insensitive; the commenter and an assignee may be spelt apart. */
const sameLogin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** What a refusal says, to whom, and how the operator surface records it. */
interface Refusal {
    readonly login: string;
    readonly body: string;
    readonly explain: string;
}

/** The one managed notice per person on this issue; a refusal claims nothing absent. */
function refusal(platform: Platform, { login, body, explain }: Refusal) {
    return platform.intent({
        operation: "postManagedComment",
        desired: { kind: "notice", topic: login, body },
        cause: CLAIM,
        explain,
    });
}

/** A claim: block and bot, holders, claimability, the cap, then the assign carrying its notice. */
async function onAssign(facts: Facts, view: View, platform: Platform, login: string) {
    const { autoAssign, unassign } = view.settings;
    if (!autoAssign.enabled) return [];
    const canRelease = unassign.enabled;
    if (await platform.ask("isAutomationActor", { login })) return [];

    const holders = await platform.ask("assigneesOf", { item: facts.item });
    if (holders.some((holder) => sameLogin(holder, login))) {
        return platform.skip(
            "Skipped: the commenter already holds this issue.",
            `commenter: ${login}`,
        );
    }
    if (holders.length > 0) {
        return [
            refusal(platform, {
                login,
                body: alreadyClaimed(login, holders),
                explain: "Told the commenter the issue is already claimed.",
            }),
        ];
    }

    // Deny wins: a meaning in notClaimableWhen refuses whatever claimableOnlyWhen allows.
    const carried = meaningsOf(facts);
    const denied = autoAssign.notClaimableWhen.filter((meaning) => carried.includes(meaning));
    if (denied.length > 0) {
        return [
            refusal(platform, {
                login,
                body: deniedBy(login, denied),
                explain: "Told the commenter why the issue cannot be claimed.",
            }),
        ];
    }
    const required = autoAssign.claimableOnlyWhen;
    if (required.length > 0 && !required.some((meaning) => carried.includes(meaning))) {
        return [
            refusal(platform, {
                login,
                body: notYetClaimable(login, required, carried),
                explain: "Told the commenter the issue is not claimable yet.",
            }),
        ];
    }

    if (autoAssign.maxOpen > 0) {
        const open = await platform.ask("openAssignments", { login });
        const held = open.filter(
            ({ meanings }) => !meanings.some((meaning) => autoAssign.capIgnores.includes(meaning)),
        ).length;
        if (held >= autoAssign.maxOpen) {
            return [
                refusal(platform, {
                    login,
                    body: atCap(login, held, autoAssign.maxOpen, canRelease),
                    explain: "Told the commenter they are at this repository's cap.",
                }),
            ];
        }
    }

    // The notice rides the assign, posted only once GitHub shows the commenter assigned.
    return [
        platform.intent({
            operation: "assign",
            desired: { login, notice: { topic: login, body: claimed(login, canRelease) } },
            cause: CLAIM,
            claims: { meaningsAbsent: autoAssign.notClaimableWhen },
            explain: "Assigned the commenter, who claimed the issue, and confirmed it to them.",
        }),
    ];
}

/** A release: only the commenter's own assignment, never anyone else's (P3). */
async function onUnassign(facts: Facts, view: View, platform: Platform, login: string) {
    if (!view.settings.unassign.enabled) return [];
    if (await platform.ask("isAutomationActor", { login })) return [];

    const holders = await platform.ask("assigneesOf", { item: facts.item });
    if (!holders.some((holder) => sameLogin(holder, login))) {
        return platform.skip(
            "Skipped: the commenter is not assigned to this issue, so nothing of theirs was released.",
            `commenter: ${login}`,
        );
    }
    const othersRemain = holders.some((holder) => !sameLogin(holder, login));
    return [
        platform.intent({
            operation: "unassign",
            desired: { login, notice: { topic: login, body: released(login, othersRemain) } },
            cause: RELEASE,
            explain: "Unassigned the commenter at their request, and confirmed it to them.",
        }),
    ];
}

export const assignment: Capability<AssignmentDeclaration> = {
    declaration: assignmentDeclaration,

    async evaluate(facts, view, platform): Promise<Intents> {
        const unmapped = unmappedCommands(view);
        if (unmapped.length > 0) return platform.skip("Skipped: settings unusable.", ...unmapped);

        // A command speaks for whoever typed it, never for the delivery's sender.
        const { issued, by } = facts.command;
        if (issued === "assign") return onAssign(facts, view, platform, by);
        if (issued === "unassign") return onUnassign(facts, view, platform, by);
        return [];
    },
};
