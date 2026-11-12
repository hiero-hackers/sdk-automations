/**
 * The scrubber — protocol 7.1's rules as code (D87).
 *
 * Deterministic replacement, not deletion: identifiers map to stable
 * placeholders within one payload, keeping a fixture referentially faithful.
 */

/** Keys whose STRING value names an account, org, or repository. */
const IDENTIFYING_KEYS = new Set(["login", "slug", "name", "full_name"]);

/** Keys whose NUMERIC value is a GitHub database id. */
const ID_KEYS = new Set(["id", "database_id", "installation_id", "hook_id"]);

const EMAIL = /[^\s"@]+@[^\s"@]+\.[^\s"@]+/g;

/** Full-length git object ids tie a fixture to sandbox history. */
const GIT_SHA = /^[0-9a-f]{40}$/;

/** An App's account names software, not a person, and capabilities judge bots by this suffix. */
const isAppLogin = (value: string): boolean => value.endsWith("[bot]");

/** Deterministic 40-hex placeholder: same input sha, same output sha. */
function shaFor(sha: string, mapping: Mapping): string {
    const existing = mapping.strings.get(sha);
    if (existing !== undefined) return existing;
    const stamped = String(mapping.strings.size + 1).padStart(40, "0");
    mapping.strings.set(sha, stamped);
    return stamped;
}

interface Mapping {
    readonly strings: Map<string, string>;
    readonly numbers: Map<number, number>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Pass one: map every identifying value to a placeholder. `name` and
 * `full_name` identify only inside an object carrying `login`/`slug`/`full_name`.
 */
function collect(value: unknown, mapping: Mapping): void {
    if (Array.isArray(value)) {
        for (const item of value) collect(item, mapping);
        return;
    }
    if (!isRecord(value)) return;

    const identityObject =
        typeof value["login"] === "string" ||
        typeof value["slug"] === "string" ||
        typeof value["full_name"] === "string";

    for (const [key, child] of Object.entries(value)) {
        if (typeof child === "string" && IDENTIFYING_KEYS.has(key)) {
            if (!identityObject && (key === "name" || key === "full_name")) continue;
            if (key === "login" && isAppLogin(child)) continue;
            for (const part of child.split("/")) {
                if (part !== "" && !mapping.strings.has(part)) {
                    mapping.strings.set(part, `scrubbed-${mapping.strings.size + 1}`);
                }
            }
            continue;
        }
        // Registered before any rewrite, so prose quoting a sha is rewritten whatever the order.
        if (typeof child === "string" && GIT_SHA.test(child)) {
            shaFor(child, mapping);
            continue;
        }
        if (typeof child === "number" && ID_KEYS.has(key)) {
            if (!mapping.numbers.has(child)) {
                mapping.numbers.set(child, mapping.numbers.size + 1);
            }
            continue;
        }
        collect(child, mapping);
    }
}

/** Longest-first, so `octo-org-repo` is not half-replaced via `octo-org`. */
function rewrite(text: string, mapping: Mapping): string {
    let out = text.replace(EMAIL, "scrubbed@example.invalid");
    for (const original of [...mapping.strings.keys()].sort((a, b) => b.length - a.length)) {
        out = out.split(original).join(mapping.strings.get(original)!);
    }
    // A short sha is the seven-character prefix GitHub and the Action print.
    for (const [original, stamp] of mapping.strings) {
        if (GIT_SHA.test(original)) out = out.split(original.slice(0, 7)).join(stamp.slice(0, 7));
    }
    return out;
}

function transform(value: unknown, mapping: Mapping): unknown {
    if (Array.isArray(value)) return value.map((item) => transform(item, mapping));
    if (isRecord(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            if (key === "node_id" && typeof child === "string") {
                out[key] = "SCRUBBED_NODE_ID";
            } else if (key === "description" && typeof child === "string") {
                // Free prose the normalizer never reads: blanked wholesale.
                out[key] = child === "" ? "" : "scrubbed-description";
            } else if (typeof child === "string" && GIT_SHA.test(child)) {
                out[key] = shaFor(child, mapping);
            } else if (typeof child === "number" && ID_KEYS.has(key)) {
                out[key] = mapping.numbers.get(child) ?? child;
            } else {
                out[key] = transform(child, mapping);
            }
        }
        return out;
    }
    if (typeof value === "string") return rewrite(value, mapping);
    return value;
}

/**
 * Scrub one webhook payload. Deterministic: the same payload, and the same
 * identifier within it, always produce the same output.
 */
export function scrubPayload(payload: unknown): unknown {
    const mapping: Mapping = { strings: new Map(), numbers: new Map() };
    collect(payload, mapping);
    return transform(payload, mapping);
}
