/**
 * The protocols the runner can drive, in the order it runs them, and the batch that runs
 * before a tag when none is named.
 */

import { budget } from "./budget.js";
import { capabilityMode } from "./capability-mode.js";
import { conformance } from "./conformance.js";
import { firstEffects } from "./first-effects.js";
import { grace } from "./grace.js";
import type { Protocol } from "./kit.js";
import { pilotShape } from "./pilot-shape.js";
import { reRun } from "./re-run.js";
import { sameSecond } from "./same-second.js";

export const PROTOCOLS: readonly Protocol[] = [
    conformance,
    firstEffects,
    grace,
    sameSecond,
    reRun,
    budget,
    pilotShape,
    capabilityMode,
];

export const PRE_TAG: readonly string[] = ["9.1", "9.2", "9.4", "9.6"];
