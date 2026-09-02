/**
 * GitHub exposes two different webhook-delivery identifiers:
 *
 * - `X-GitHub-Delivery` and a delivery record's `guid` identify the
 *   delivered event and are the deduplication key.
 * - a delivery record's numeric `id` identifies the REST resource used
 *   by get/redeliver endpoints. These values exceed 2^53.
 *
 * Keeping separate brands prevents the intake deduper from receiving a
 * REST record id and prevents redelivery code from receiving a GUID.
 */

declare const deliveryGuidBrand: unique symbol;
declare const deliveryRecordIdBrand: unique symbol;

/** The GUID carried by `X-GitHub-Delivery`; the durable deduplication key. */
export type DeliveryGuid = string & { readonly [deliveryGuidBrand]: true };

/** The decimal REST delivery-record id; never convert it to a number. */
export type DeliveryRecordId = string & {
    readonly [deliveryRecordIdBrand]: true;
};

// Lowercase only, deliberately: GitHub sends lowercase, and the store keys
// deliveries by BINARY comparison, so a case-variant of a seen GUID would be
// admitted as a SECOND delivery rather than deduplicated against the first.
// Refusing the case nobody sends is cheaper than teaching every comparison
// about case folding.
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function asDeliveryGuid(raw: string): DeliveryGuid | undefined {
    return typeof raw === "string" && GUID_PATTERN.test(raw) ? (raw as DeliveryGuid) : undefined;
}

export function asDeliveryRecordId(raw: string): DeliveryRecordId | undefined {
    return typeof raw === "string" && /^\d+$/.test(raw) ? (raw as DeliveryRecordId) : undefined;
}
