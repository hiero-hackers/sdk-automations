/**
 * What a capability author writes against: declaration, settings, facts, the
 * handle it is called through. Closed (D61); comment identity is platform-owned
 * (D125). Not here: effects (`../intents/`), the shared vocabulary
 * (`../catalogue.ts`), config (`../config/`), safety (`../safety/`), workflow (`../workflow/`).
 */
export * from "./producers.js";
export {
    GROUPS,
    PRODUCER_KINDS,
    carriesFactGroup,
    decodeKept,
    deliveredGroups,
    factGroupUnread,
    fixtureOf,
    keptOn,
    readersOf,
    type AnyGroupValue,
    type Delivered,
    type DeliveredGroups,
    type GroupDelivery,
    type GroupMissingCode,
    type GroupModule,
    type GroupValue,
    type KeptGroups,
    type KeptOn,
} from "./groups/index.js";
export * from "./facts.js";
export * from "./declaration.js";
export * from "./factory.js";
export * from "./boundary.js";
export { skipped } from "./guards.js";
export {
    block,
    count,
    duration,
    DURATION_PATTERN,
    flag,
    LOGIN_PATTERN,
    logins,
    MAX_CLOCK_HOURS,
    meanings,
    parseDuration,
    section,
    spec,
    text,
    writeDuration,
} from "./settings.js";
