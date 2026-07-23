/**
 * Identifier types whose misuse must be unrepresentable.
 *
 * FINDING(delivery-id-precision), experiment 6.2: GitHub webhook delivery
 * ids exceed 2^53, and a naive `JSON.parse` silently corrupted the
 * trailing digits — a redelivery by the corrupted id would 404. Any
 * component that stores, compares, or redelivers by delivery id must
 * treat it as an opaque string; the branded type below makes a numeric
 * delivery id a compile error rather than a code-review catch.
 */

declare const deliveryIdBrand: unique symbol;

/** An opaque GitHub webhook delivery id. Never a number. */
export type DeliveryId = string & { readonly [deliveryIdBrand]: true };

/**
 * Validate a raw string as a delivery id. Returns `undefined` for
 * anything that is not a non-empty digit string — including the
 * scientific-notation and rounded forms that number round-trips
 * produce, which is exactly the corruption this type exists to stop.
 */
export function asDeliveryId(raw: string): DeliveryId | undefined {
    return /^\d+$/.test(raw) ? (raw as DeliveryId) : undefined;
}
