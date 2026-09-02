/**
 * The shell owns ORDER, not decisions: verify before accept, accept
 * before ack, decide before act, then atomically commit the canonical report
 * and delivery completion (D93, D110).
 * `main.ts` is the runnable entry point and is deliberately not exported.
 */
export * from "./receiver.js";
export * from "./config.js";
export * from "./externals.js";
export * from "./effects.js";
export * from "./apply.js";
export * from "./log.js";
export * from "./shell.js";
