/**
 * What change one intent makes, worded for the safety gate and the rehearsal
 * record. Each operation is worded by its own module, not here.
 */

import type { IntentOperation } from "../catalogue.js";
import {
    INTENT_OPERATIONS,
    OPERATIONS,
    type AnyIntent,
    type OperationModule,
} from "../intents/index.js";
import type { RepositoryConfig } from "../config/index.js";
import type { WriteRequest } from "../safety/index.js";
import { finding, type Finding, type Subject } from "../report/index.js";

/** The exact item and value an adapter may change, as contracts/safety.md requires. */
export function describeChange(intent: AnyIntent): string {
    const module = OPERATIONS[intent.operation] as OperationModule<IntentOperation>;
    return module.describeChange(intent);
}

/** The one recipe for the safety request an intent is judged by, here and in the applier. */
export function writeRequestFor(intent: AnyIntent): WriteRequest {
    const facts = INTENT_OPERATIONS[intent.operation];
    return {
        capability: intent.capability,
        actionClass: facts.actionClassFloor,
        requiredPermissions: [facts.permission],
        cause: intent.cause.cause,
        causeObservedAt: intent.cause.observedAt,
        ...(intent.evaluatedAt === undefined ? {} : { evaluatedAt: intent.evaluatedAt }),
        target: {
            item: `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)}`,
            change: describeChange(intent),
        },
    };
}

type Labels = RepositoryConfig["mappings"]["labels"];

/** The change as the maintainer will see it: a position move names the label in force. */
function rehearsed(intent: AnyIntent, labels: Labels): string {
    const change = describeChange(intent);
    if (intent.operation !== "applyMappedLabel") return change;
    const label = labels[intent.desired.meaning];
    return label === undefined ? change : `${change}, the label \`${label}\``;
}

/** What dry-run would have done. It describes rather than prepares: no identity is minted (D125). */
export function wouldApplyFinding(intent: AnyIntent, subject: Subject, labels: Labels): Finding {
    return finding(
        "info",
        "wouldApply",
        `dry-run: ${intent.capability} would ${intent.operation} on ` +
            `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)} — ` +
            `${rehearsed(intent, labels)}. Nothing was written.`,
        subject,
    );
}
