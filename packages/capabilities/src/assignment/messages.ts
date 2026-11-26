/** Everything assignment says to a contributor, and the words it says it in. */

import { inert, mentions, type MappableMeaning } from "@hiero-hackers/automation-core/author";

/** Meaning names in prose, never their labels (contract.md §2): `a`, `b` or `c`. */
function listed(meanings: readonly MappableMeaning[], conjunction: "and" | "or"): string {
    const named = meanings.map((meaning) => `\`${meaning}\``);
    const rest = named.slice(0, -1);
    const last = named.slice(-1).join("");
    return rest.length === 0 ? last : `${rest.join(", ")} ${conjunction} ${last}`;
}

/** Only a repository that releases on request is told how to. */
const stepAway = (canRelease: boolean): string =>
    canRelease ? " If you need to step away, comment this repository's unassign command." : "";

/** The claim, confirmed to the commenter it was made for. */
export function claimed(login: string, canRelease: boolean): string {
    return `✅ Hi ${mentions([login])} — you are assigned to this issue. Thank you for picking it up!${stepAway(canRelease)}`;
}

/** The holders are named, not mentioned: the refusal is for the commenter alone. */
export function alreadyClaimed(login: string, holders: readonly string[]): string {
    const named = holders.map((holder) => inert(`@${holder}`)).join(", ");
    return `Hi ${mentions([login])} — this issue is already assigned to ${named}, so it cannot be claimed.`;
}

/** An issue still at the gate has a next step: triage ends with `ready`, and the claim can follow. */
const inTriage = (carried: readonly MappableMeaning[]): string =>
    carried.includes("awaitingTriage")
        ? " It is in the triage queue; once the team marks it ready, it can be claimed."
        : "";

/** A claim refused by the `notClaimableWhen` meanings the issue carries. */
export function deniedBy(login: string, carried: readonly MappableMeaning[]): string {
    return `Hi ${mentions([login])} — this issue cannot be claimed while it is marked ${listed(carried, "and")}.${inTriage(carried)}`;
}

/** A claim refused because the issue carries none of the `claimableOnlyWhen` meanings. */
export function notYetClaimable(
    login: string,
    required: readonly MappableMeaning[],
    carried: readonly MappableMeaning[],
): string {
    return `Hi ${mentions([login])} — only an issue marked ${listed(required, "or")} can be claimed in this repository, and this one is not yet.${inTriage(carried)}`;
}

/** A claim refused at `maxOpen`, counting only the assignments `capIgnores` leaves in. */
export function atCap(login: string, held: number, limit: number, canRelease: boolean): string {
    const assignments = held === 1 ? "1 open assignment" : `${String(held)} open assignments`;
    const release = canRelease
        ? " Release one with this repository's unassign command, and you can claim this issue."
        : "";
    return `Hi ${mentions([login])} — you already have ${assignments}, and this repository's limit is ${String(limit)}.${release}`;
}

/** Rewrites the claim notice in place, so it tells the whole story: claimed, then released. */
export function released(login: string, othersRemain: boolean): string {
    const next = othersRemain ? "" : " The issue is open for anyone to pick up.";
    return `${mentions([login])} claimed this issue and has since been unassigned at their request.${next}`;
}
