/**
 * The capability layer: what a capability may declare, and how it is called.
 *
 * `catalogue.ts` holds the closed vocabularies. `managed.ts` owns the identity
 * of the App's own comments. `declaration.ts` owns direct boot admission.
 * `intent.ts` is what a capability asks for plus the screens that request
 * passes, `factory.ts` how one is built, and `boundary.ts` how the platform
 * invokes a capability and what it lets it see.
 */
export * from "./catalogue.js";
export * from "./managed.js";
export * from "./declaration.js";
export * from "./intent.js";
export * from "./factory.js";
export * from "./boundary.js";
