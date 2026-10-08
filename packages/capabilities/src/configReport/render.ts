/**
 * The comment's two bodies: what a parsed `sdk-automations.yml` would mean, and
 * why a rejected one was rejected. Pure functions over a `ConfigResult`.
 *
 * Every string that came out of the file is rendered through `inert()`, and
 * nothing here opens a fenced code block.
 */

import {
    inert,
    LABEL_DEFAULTS,
    type ConfigError,
    type MappableMeaning,
    type ConfigResult,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core/author";

/** Two spaces a level, the indentation every example in `docs/` uses. */
const indent = (depth: number): string => "  ".repeat(depth);

const bullet = (depth: number, text: string): string => `${indent(depth)}- ${text}`;

/** The heading and the closing line, so the two bodies are recognisably one report. */
const TITLE = "### `sdk-automations.yml` — what this pull request would mean";
const FOOTER = "Read on the default branch, this changes nothing until it merges.";
const MAX_COMMENT_CHARS = 12_000;
const MAX_REPORTED_ERRORS = 100;
const SHORTENED = "_Report shortened to fit in a GitHub comment._";

/** The lines as one body. Blank entries are markdown's paragraph breaks. */
const join = (lines: readonly string[]): string => lines.join("\n");

/** The body within GitHub's limit, cut on a whole character and never inside an escape. */
function fitComment(body: string): string {
    if (body.length <= MAX_COMMENT_CHARS) return body;
    const ending = `\n\n${SHORTENED}\n\n${FOOTER}`;
    let end = MAX_COMMENT_CHARS - ending.length;
    if (body.charCodeAt(end - 1) >= 0xd800 && body.charCodeAt(end - 1) <= 0xdbff) end -= 1;
    while (body[end - 1] === "\\") end -= 1;
    return `${body.slice(0, end)}${ending}`;
}

/** One settings value as text. `null` is a written absence, shown as `unset`. */
function scalar(value: unknown): string {
    if (value === null) return "unset";
    if (typeof value === "string") return inert(value);
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    return inert(String(value));
}

function isGroup(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A resolved settings block as a nested list, recursive because blocks are. */
function tree(group: Readonly<Record<string, unknown>>, depth: number): readonly string[] {
    return Object.entries(group).flatMap(([key, value]) => {
        const name = inert(key);
        if (isGroup(value)) return [bullet(depth, name), ...tree(value, depth + 1)];
        if (Array.isArray(value)) {
            const entries = (value as readonly unknown[]).map(scalar);
            return [
                bullet(depth, `${name}: ${entries.length === 0 ? "none" : entries.join(", ")}`),
            ];
        }
        return [bullet(depth, `${name}: ${scalar(value)}`)];
    });
}

/** The labels an enabled capability may set, under the spelling in force, and how each is defined if missing (D204). */
function labelsSetBy(
    config: RepositoryConfig,
    meanings: readonly MappableMeaning[],
): readonly string[] {
    if (meanings.length === 0) return [];
    return [
        bullet(1, "labels it may set"),
        ...meanings.map((meaning) => {
            const spelling = config.mappings.labels[meaning] ?? LABEL_DEFAULTS[meaning].name;
            return bullet(
                2,
                `${inert(spelling)} — ${meaning}; defined #${LABEL_DEFAULTS[meaning].color} if the repository lacks it`,
            );
        }),
    ];
}

/** Every capability the file switched on, with what its block resolved to. */
function capabilities(config: RepositoryConfig): readonly string[] {
    const entries = Object.entries(config.capabilities);
    const on = entries.filter(([, block]) => block.enabled);
    const off = entries.filter(([, block]) => !block.enabled).map(([name]) => inert(name));

    const lines = on.flatMap(([name, block]) => {
        const settings = tree(block.settings, 1);
        const labels = labelsSetBy(config, block.labels ?? []);
        return settings.length === 0 && labels.length === 0
            ? [bullet(0, `${inert(name)} — on, no settings`)]
            : [bullet(0, `${inert(name)} — on`), ...settings, ...labels];
    });
    return [
        "**Capabilities**",
        "",
        ...(lines.length === 0 ? [bullet(0, "none — this file enables no capability")] : lines),
        ...(off.length === 0 ? [] : ["", `Switched off: ${off.join(", ")}.`]),
    ];
}

/** The `mappings:` section, family by family; a parsed document always carries the labels (D203). */
function mappings(config: RepositoryConfig): readonly string[] {
    const families = Object.entries(config.mappings).filter(
        ([, family]) => Object.keys(family).length > 0,
    );
    if (families.length === 0) return ["**Mappings** — none."];
    return [
        "**Mappings**",
        "",
        ...families.flatMap(([family, spellings]) => [
            bullet(0, family),
            ...Object.entries(spellings as Readonly<Record<string, string>>).map(
                ([meaning, spelling]) => bullet(1, `${inert(meaning)}: ${inert(spelling)}`),
            ),
        ]),
    ];
}

function principals(config: RepositoryConfig): readonly string[] {
    const declared = Object.entries(config.principals);
    if (declared.length === 0) return [];
    return [
        "",
        "**Principals**",
        "",
        ...declared.map(([name, handle]) => bullet(0, `${inert(name)}: ${inert(handle)}`)),
    ];
}

/** What the App would read from this file, if it merged. */
export function renderConfiguration(revision: string, config: RepositoryConfig): string {
    return fitComment(
        join([
            TITLE,
            "",
            `The file at \`${revision}\` parses. This is what the App would read from it.`,
            "",
            `**Mode** — ${config.mode}`,
            "",
            ...capabilities(config),
            "",
            ...mappings(config),
            ...principals(config),
            "",
            FOOTER,
        ]),
    );
}

const lastSegment = (path: string): string => path.slice(path.lastIndexOf(".") + 1);

/** Everything above the key itself, with the separating dot, or `""` at the root. */
const enclosing = (path: string): string => path.slice(0, path.lastIndexOf(".") + 1);

/**
 * Is `inner` a consequence of `outer` rather than a mistake of its own? The
 * relation is the inheritance the settings cascade walks (D147).
 */
function inherits(inner: ConfigError, outer: ConfigError): boolean {
    if (inner.path === null || outer.path === null || inner.path === outer.path) return false;
    return (
        lastSegment(inner.path) === lastSegment(outer.path) &&
        enclosing(inner.path).startsWith(enclosing(outer.path)) &&
        enclosing(inner.path).length > enclosing(outer.path).length
    );
}

/**
 * Document order: the whole-document problems first, then everything the
 * parser could place, then whatever it could not.
 */
function documentOrder(errors: readonly ConfigError[]): readonly ConfigError[] {
    const rank = (error: ConfigError): number =>
        error.path === null ? 0 : error.line === undefined ? 2 : 1;
    return [...errors].sort((a, b) => rank(a) - rank(b) || (a.line ?? 0) - (b.line ?? 0));
}

/** One error's sentence, without saying the path twice (D77). */
function sentence(error: ConfigError): string {
    const message = error.message;
    const prefix = error.path === null ? null : `${error.path}: `;
    return inert(
        prefix !== null && message.startsWith(prefix) ? message.slice(prefix.length) : message,
    );
}

function line(error: ConfigError): string {
    const where = error.line === undefined ? "" : `line ${String(error.line)} — `;
    const path = error.path === null ? "" : `${inert(error.path)}: `;
    return bullet(0, `${where}${path}${sentence(error)}`);
}

/**
 * The error a consequence followed from, or `null` when it is its own. At most
 * one cause can enclose a given error, so a `find` is the whole answer.
 */
function causeOf(error: ConfigError, causes: readonly ConfigError[]): ConfigError | null {
    return causes.find((cause) => inherits(error, cause)) ?? null;
}

/** Why the file was rejected, one line each, with the cascade folded up. */
export function renderRejection(revision: string, errors: readonly ConfigError[]): string {
    const omitted = Math.max(0, errors.length - MAX_REPORTED_ERRORS);
    const ordered = documentOrder(errors.slice(0, MAX_REPORTED_ERRORS));
    const causes = ordered.filter((error) => !ordered.some((other) => inherits(error, other)));

    const lines = causes.flatMap((cause) => {
        const followers = ordered.filter((error) => causeOf(error, causes) === cause);
        return followers.length === 0
            ? [line(cause)]
            : [line(cause), bullet(1, `and ${String(followers.length)} places that inherit it`)];
    });

    return fitComment(
        join([
            TITLE,
            "",
            `The file at \`${revision}\` is rejected, so the App would read no configuration from it ` +
                "at all — one error anywhere rejects the whole document.",
            "",
            ...(omitted === 0 ? [] : [bullet(0, `${String(omitted)} more errors not shown`), ""]),
            ...lines,
            "",
            FOOTER,
        ]),
    );
}

/** The body for whichever half of the result came back. */
export function renderReport(revision: string, result: ConfigResult): string {
    return result.ok
        ? renderConfiguration(revision, result.config)
        : renderRejection(revision, result.errors);
}
