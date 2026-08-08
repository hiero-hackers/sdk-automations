/**
 * How GitHub signs a webhook delivery — knowledge that belongs here by this
 * directory's inclusion test, extracted from the lab's capture receiver the
 * moment a second consumer became visible: the shell must verify the same
 * signature before it acks (P9), and two private copies of a signature
 * scheme is how one of them quietly stops rejecting.
 *
 * DOCUMENTED knowledge, not perishable: the scheme is GitHub's published
 * contract (HMAC-SHA256 of the raw body, hex, `sha256=` prefix, in the
 * header below), so it carries no `probedAt` — unlike `failures.ts`, whose
 * facts GitHub never promised.
 *
 * Pure computation. `node:crypto` is deterministic bytes-to-bytes work, the
 * same standing the `yaml` dependency has (D82): no I/O, no clock, no
 * environment.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The header GitHub sends the signature in, lowercase as Node presents it. */
export const SIGNATURE_HEADER = "x-hub-signature-256";

/** Sign a raw body the way GitHub does — for tests and simulated deliveries. */
export function signBody(secret: string, body: Uint8Array | string): string {
    return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Verify a delivery's signature header against the raw body.
 *
 * Total: absent or malformed headers are `false`, never a throw — a webhook
 * endpoint is the single most attacker-reachable line of the system, and a
 * verifier that can be crashed is a verifier that can be bypassed.
 * Comparison is constant-time via `timingSafeEqual`; the length guard exists
 * because `timingSafeEqual` THROWS on unequal lengths rather than returning
 * false.
 */
export function verifyBody(
    secret: string,
    body: Uint8Array | string,
    header: string | undefined,
): boolean {
    if (header === undefined) return false;
    const expected = Buffer.from(signBody(secret, body));
    const presented = Buffer.from(header);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
}
