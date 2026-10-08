/**
 * `docs/automations.schema.json` — what an editor checks an `automations.yml`
 * against, rendered from the same specs the parser reads that file with.
 *
 * A whole file rather than a block inside one: JSON carries no comments, so
 * there is no marker pair to write between and nothing hand-written to keep.
 * `generated.ts` holds the worklist both kinds of output share.
 *
 * The schema is a SPELLING check and says so in its own top-level
 * `description`. Injectivity, a `duration`'s ceiling and relations, the cascade,
 * the cross-file rule that a settings value naming a label or a principal must
 * name one this same document maps — every one of those is a question about two
 * places at once, or about a constant a pattern cannot carry, and JSON Schema
 * can ask neither. A maintainer who reads a green editor as
 * a parsed file is the failure this file must not create.
 *
 * Three vocabularies meet here and each one is walked rather than copied:
 * `TOP_LEVEL_KEYS` and `MAPPING_SECTION_KEYS` decide what the document admits,
 * and `describeSpec` decides what each capability's `settings` block admits.
 * The map from a field's kind to a subschema is exhaustive over
 * `FieldDescription["kind"]`, so a seventh constructor fails to compile here
 * until an editor knows what to do with it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    CAPABILITY_NAME_PATTERN,
    COMMANDS,
    describeSpec,
    DURATION_PATTERN,
    MAPPABLE_MEANINGS,
    MAPPING_SECTION_KEYS,
    REPOSITORY_MODES,
    SKILL_TIERS,
    TOP_LEVEL_KEYS,
    type FieldDescription,
    type MappingSectionKey,
    type TopLevelKey,
} from "@hiero-hackers/automation-core";
import { shippedCapabilities } from "./capabilities.js";
import { repoRoot } from "./repository.js";

// ─── Where the schema lives ──────────────────────────────────────────

/** Repository-relative, so the runner, the lock and the `$id` name it once. */
export const SCHEMA_PATH = "docs/automations.schema.json";

/**
 * The branch a maintainer's editor fetches the schema from. The default branch
 * — the one every badge and issue-template link in this repository already
 * names — because a configuration in an open pull request does not take effect
 * either (`docs/quickstart.md`).
 */
const DEFAULT_BRANCH = "main";

/** `https://github.com/owner/name.git` → `owner/name`, or null if it is neither. */
function gitHubSlug(url: string): string | null {
    return /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
}

/**
 * The raw URL this schema is served from, from the manifest's own `repository`
 * — the one place the repository names itself to a package manager, so a fork
 * or a rename moves the URL with it rather than leaving a link to somebody
 * else's file.
 */
export const SCHEMA_URL: string = (() => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
        repository?: { url?: string };
    };
    const url = manifest.repository?.url ?? "";
    const slug = gitHubSlug(url);
    if (slug === null) throw new Error(`package.json repository.url is not a GitHub URL: ${url}`);
    return `https://raw.githubusercontent.com/${slug}/${DEFAULT_BRANCH}/${SCHEMA_PATH}`;
})();

// ─── One field ───────────────────────────────────────────────────────

/** As much of JSON Schema as this generator writes — never read back. */
type Subschema = Readonly<Record<string, unknown>>;

/** A described spec: every field of one level, keyed by the name it is written under. */
type Described = Readonly<Record<string, FieldDescription>>;

/** A `doc` as a `description`: one sentence, ending in a full stop. */
function sentence(doc: string): string {
    return /[.!?]$/.test(doc) ? doc : `${doc}.`;
}

/**
 * An object whose keys are exactly the ones the spec names.
 *
 * `additionalProperties: false` wherever it appears is the parser's own
 * `unknownKey` rule: every group constructor sweeps its own level (D4), so the
 * editor may refuse a stranger at the depth the parser would.
 */
function groupSchema(fields: Described): Subschema {
    const required = Object.entries(fields)
        .filter(([, field]) => field.absent === "problem")
        .map(([key]) => key);
    return {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
            Object.entries(fields).map(([key, field]) => [key, fieldSchema(field)]),
        ),
        ...(required.length === 0 ? {} : { required }),
    };
}

/** A block: its spec's fields, plus the consent key that is not one of them. */
function blockSchema(fields: Described): Subschema {
    const running = groupSchema(fields);
    return {
        oneOf: [
            {
                ...running,
                properties: {
                    enabled: { const: true, description: "Run this block." },
                    ...(running.properties as Subschema),
                },
                required: [
                    "enabled",
                    ...((running.required as readonly string[] | undefined) ?? []),
                ],
            },
            {
                type: "object",
                properties: {
                    enabled: {
                        const: false,
                        description: "Leave this block parked and unread.",
                        default: false,
                    },
                },
            },
        ],
    };
}

/** The shape one kind of field takes, with no sentence and no default on it yet. */
function shapeOf(field: FieldDescription): Subschema {
    switch (field.kind) {
        case "flag":
            return { type: "boolean" };
        case "duration":
            // The one rule a schema can state about this key alone: the
            // spelling, from the same pattern the parser reads it with. The
            // ceiling is a comparison against a constant no pattern carries,
            // so it stays the parser's, like the relation and the cascade.
            return { type: "string", pattern: DURATION_PATTERN.source };
        case "count":
            return { type: "integer", minimum: 0 };
        case "text":
            return { type: "string" };
        case "meanings":
            return { type: "array", items: { enum: [...MAPPABLE_MEANINGS] } };
        case "section":
            return groupSchema(field.fields ?? {});
        case "block":
            return blockSchema(field.fields ?? {});
        default: {
            // A kind with no shape is a constructor no editor can check.
            const unhandled: never = field.kind;
            throw new Error(`no editor schema for a ${String(unhandled)} field`);
        }
    }
}

/**
 * What a reader of the schema is told beyond the shape: the sentence, and the
 * rule a `duration`'s shape cannot say — its pattern says which strings pass
 * but not what they MEAN, and an editor underlining `2w` with nothing but a
 * regex leaves a maintainer guessing at which units exist.
 */
const KIND_RULES: Partial<Record<FieldDescription["kind"], string>> = {
    duration:
        "A length of time: a whole number and a unit, `4h` or `14d`. No minutes, no weeks, no mixed units.",
};

function noteOf(field: FieldDescription): string | null {
    const said = field.doc === null ? null : sentence(field.doc);
    const rule = KIND_RULES[field.kind];
    if (rule === undefined) return said;
    return said === null ? rule : `${said} ${rule}`;
}

/** One field: its shape, its sentence, and its default where it has one. */
function fieldSchema(field: FieldDescription): Subschema {
    const note = noteOf(field);
    return {
        ...shapeOf(field),
        ...(note === null ? {} : { description: note }),
        ...(field.default === undefined ? {} : { default: field.default }),
    };
}

// ─── The document ────────────────────────────────────────────────────

/**
 * What the schema cannot check, said once where a reader meets it first.
 *
 * Every clause names a rule the parser applies across two places at once. The
 * list is not a promise to stay complete; the last sentence is what a reader
 * has to carry away.
 */
const DISCLAIMER = [
    "Every key the Hiero SDK automations App reads, with the sentence each capability's own",
    "settings spec carries. Shape and spelling only: that label, command, skill and alert",
    "mappings are injective and share one namespace, that a settings value naming a meaning or",
    "a principal names one this same file maps, that a `duration` is inside the platform's",
    "century ceiling and sits the required distance above the one it is measured against, and",
    "that a capability is only enabled once the meanings it requires are mapped — none of those",
    "are questions JSON Schema can ask. The",
    "App's parser is the authority; this schema catches shape and spelling.",
].join(" ");

/** One sentence per top-level key, for the maintainer hovering over it. */
const TOP_LEVEL_NOTES: { readonly [K in TopLevelKey]: string } = {
    schemaVersion: "The configuration format's version. Optional; the only value is 2.",
    mode: "How far the App may go. Each step does what the one before it does, and more.",
    capabilities:
        "One block per automation. A capability this App does not ship is rejected whether it is enabled or not.",
    mappings: "The words this repository spells each meaning with.",
    principals: "The names a capability may address, one handle or team slug each.",
};

/** One sentence per mapping family, for the same reader. */
const FAMILY_NOTES: { readonly [F in MappingSectionKey]: string } = {
    labels: "The App names the position; you supply the label it is spelled with.",
    commands: "The words a contributor types in a comment. Each must start with a slash.",
    skills: "The difficulty ladder, as labels. The order is the App's, not this file's.",
    alerts: "Alerts are yours to name, each carried by a label. A capability's settings may name one.",
};

/** A family of spellings: the meanings the platform admits, each mapped to a string. */
function closedFamily(meanings: readonly string[], note: string, spelling: Subschema): Subschema {
    return {
        type: "object",
        description: note,
        additionalProperties: false,
        properties: Object.fromEntries(meanings.map((meaning) => [meaning, spelling])),
    };
}

/** The one open family: the repository names the alerts, so only their shape is checked. */
function openFamily(note: string): Subschema {
    return {
        type: "object",
        description: note,
        additionalProperties: false,
        patternProperties: { [CAPABILITY_NAME_PATTERN.source]: { type: "string" } },
    };
}

/** The `mappings:` section, family by family, in the order the parser reads them. */
function mappingsSchema(): Subschema {
    const families: { readonly [F in MappingSectionKey]: () => Subschema } = {
        labels: () => closedFamily(MAPPABLE_MEANINGS, FAMILY_NOTES.labels, { type: "string" }),
        commands: () =>
            closedFamily(COMMANDS, FAMILY_NOTES.commands, { type: "string", pattern: "^/" }),
        skills: () => closedFamily(SKILL_TIERS, FAMILY_NOTES.skills, { type: "string" }),
        alerts: () => openFamily(FAMILY_NOTES.alerts),
    };
    return {
        type: "object",
        description: TOP_LEVEL_NOTES.mappings,
        additionalProperties: false,
        properties: Object.fromEntries(
            MAPPING_SECTION_KEYS.map((family) => [family, families[family]()]),
        ),
    };
}

/**
 * The `capabilities:` section: one property per shipped capability, and nothing
 * else. A capability's block has the same shape as every block inside it —
 * `enabled` and the spec's own keys beside it.
 */
function capabilitiesSchema(): Subschema {
    const one = (name: string, fields: Described): Subschema => {
        const settings = groupSchema(fields);
        return {
            ...settings,
            properties: {
                enabled: {
                    type: "boolean",
                    description: `Run ${name}. Consent is literally true; absent leaves it off.`,
                    default: false,
                },
                ...(settings.properties as Subschema),
            },
        };
    };
    return {
        type: "object",
        description: TOP_LEVEL_NOTES.capabilities,
        additionalProperties: false,
        properties: Object.fromEntries(
            shippedCapabilities().map(({ name, settings }) => [
                name,
                one(name, describeSpec(settings)),
            ]),
        ),
    };
}

/**
 * The whole document, keyed off `TOP_LEVEL_KEYS` so the property order is the
 * order a maintainer meets the keys in and a new one fails to compile here.
 */
function documentShape(): Subschema {
    const sections: { readonly [K in TopLevelKey]: () => Subschema } = {
        schemaVersion: () => ({ const: 2, description: TOP_LEVEL_NOTES.schemaVersion }),
        mode: () => ({
            enum: [...REPOSITORY_MODES],
            description: TOP_LEVEL_NOTES.mode,
            default: "observe",
        }),
        capabilities: capabilitiesSchema,
        mappings: mappingsSchema,
        principals: () => ({
            type: "object",
            description: TOP_LEVEL_NOTES.principals,
            propertyNames: { pattern: CAPABILITY_NAME_PATTERN.source },
            additionalProperties: { type: "string" },
        }),
    };
    return {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(TOP_LEVEL_KEYS.map((key) => [key, sections[key]()])),
    };
}

function schemaDocument(): Subschema {
    return {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: SCHEMA_URL,
        title: "Hiero SDK automations configuration",
        description: DISCLAIMER,
        ...documentShape(),
    };
}

/** The file's whole text, four-space indented as every committed JSON here is. */
export function renderEditorSchema(): string {
    return `${JSON.stringify(schemaDocument(), null, 4)}\n`;
}
