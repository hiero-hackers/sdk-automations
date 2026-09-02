/**
 * The owned operational store: which durable state transition may commit now.
 *
 * `schema.ts` is the version contract, `store.ts` the transitions,
 * `instants.ts` the timestamp contract those transitions validate.
 * `deliveries.ts`, `effects.ts` and `schedules.ts` are the three
 * vocabularies those transitions move between states. This barrel exists so
 * consumers name the CONCERN rather than the file inside it.
 *
 * The vocabulary files are re-exported by name rather than with `*`. They
 * hold nothing private, so the two forms are equivalent — the list is here
 * because the package's whole surface is worth being able to read at once.
 */
export { assertUtcInstant } from "./instants.js";
export { CURRENT_STORAGE_SCHEMA_VERSION } from "./schema.js";
export type {
    AcceptDeliveryInput,
    AcceptDeliveryResult,
    CanonicalDeliveryReport,
    ClaimedDelivery,
    CompleteDeliveryWithReportInput,
    CompleteDeliveryWithReportResult,
    DeadLetteredDelivery,
    DeliveryState,
    ReleaseDeliveryAfterFailureInput,
    ReleaseDeliveryAfterFailureResult,
    ReleaseDeliveryResult,
} from "./deliveries.js";
export type { EffectState, OpenIntent } from "./effects.js";
export type { ClaimedScheduleRow, ScheduleRow } from "./schedules.js";
export * from "./store.js";
