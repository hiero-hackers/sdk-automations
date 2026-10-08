/**
 * What a run changes on the sandbox, and how it is put back: the configuration file, an issue
 * template, the two position labels, a repository-only webhook, and the fixture issues. Each
 * change is recorded as it lands, so restoring undoes exactly what happened, and each
 * restoration is read back.
 */

import { field, Halt, listOf, messageOf, type Call } from "./github.js";
import { LABELS } from "./scenarios.js";

const CONFIG_PATH = "sdk-automations.yml";

export const TEMPLATE_FILE = "rehearsal.yml";

const TEMPLATE_PATH = `.github/ISSUE_TEMPLATE/${TEMPLATE_FILE}`;

const LABELS_PAGE = 100;

/** The active triage queue the rehearsal arms; `welcome` is implied by the lock. */
export const ACTIVE_CONFIG = `schemaVersion: 2
mode: active
capabilities:
  triageQueue:
    enabled: true
    lockUntilTriaged: true
    confirmUnlock: true
mappings:
  labels:
    awaitingTriage: "${LABELS.triage}"
    ready: "${LABELS.ready}"
`;

/** An issue form whose only effect is the triage label at creation. */
export const TEMPLATE = `name: Rehearsal
description: Temporary form for the triage rehearsal.
labels: ["${LABELS.triage}"]
body:
  - type: textarea
    id: notes
    attributes:
      label: Notes
`;

/** A file on the default branch: its blob sha, and its text. */
interface File {
    readonly sha: string;
    readonly text: string;
}

export interface Sandbox {
    /** Records what is there, then creates the ready label, the template and the config. */
    prepare(options: { readonly template: boolean }): Promise<void>;
    /** Creates the repository-only Issues webhook and answers its id. */
    hook(url: string, secret: string): Promise<number>;
    /** Marks an issue as a fixture to unlock and close. */
    adopt(issue: number): void;
    /** Undoes every recorded change; answers each one that could not be read back as undone. */
    restore(): Promise<string[]>;
}

export function createSandbox(call: Call, owner: string, repo: string): Sandbox {
    const repository = `/repos/${owner}/${repo}`;
    let originalConfig: File | null | undefined;
    let originalLabels: ReadonlySet<string> | null = null;
    let configChanged = false;
    let templateCreated = false;
    let hookId: number | null = null;
    const fixtures: number[] = [];

    const fileAt = async (path: string): Promise<File | null> => {
        const answer = await call("GET", `${repository}/contents/${path}`, { accept: [200, 404] });
        if (answer.status === 404) return null;
        const sha = field(answer.body, "sha");
        const content = field(answer.body, "content");
        if (typeof sha !== "string" || typeof content !== "string") {
            throw new Halt(`${path} was read without a sha or content`);
        }
        return { sha, text: Buffer.from(content, "base64").toString("utf8") };
    };

    const put = async (
        path: string,
        text: string,
        message: string,
        sha?: string,
    ): Promise<void> => {
        const content = Buffer.from(text, "utf8").toString("base64");
        await call("PUT", `${repository}/contents/${path}`, {
            body: sha === undefined ? { message, content } : { message, content, sha },
            accept: [200, 201],
        });
    };

    const remove = async (path: string, message: string): Promise<void> => {
        const current = await fileAt(path);
        if (current === null) return;
        await call("DELETE", `${repository}/contents/${path}`, {
            body: { message, sha: current.sha },
        });
    };

    const labelNames = async (): Promise<Set<string>> => {
        const answer = await call("GET", `${repository}/labels?per_page=${String(LABELS_PAGE)}`);
        const names = listOf(answer, "the label list").map((label) => field(label, "name"));
        if (names.length >= LABELS_PAGE) throw new Halt("the sandbox has a page of labels or more");
        return new Set(names.filter((name): name is string => typeof name === "string"));
    };

    const restoreConfig = async (): Promise<void> => {
        if (originalConfig === null) {
            await remove(CONFIG_PATH, "rehearsal: remove the temporary configuration");
        } else if (originalConfig !== undefined) {
            const current = await fileAt(CONFIG_PATH);
            if (current?.sha !== originalConfig.sha) {
                await put(
                    CONFIG_PATH,
                    originalConfig.text,
                    "rehearsal: restore the configuration",
                    current?.sha,
                );
            }
        }
        const after = await fileAt(CONFIG_PATH);
        if ((after?.sha ?? null) !== (originalConfig?.sha ?? null)) {
            throw new Halt(`${CONFIG_PATH} reads back as ${after?.sha ?? "absent"}`);
        }
    };

    const releaseFixture = async (issue: number): Promise<void> => {
        const path = `${repository}/issues/${String(issue)}`;
        const read = await call("GET", path);
        if (field(read.body, "locked") === true) {
            await call("DELETE", `${path}/lock`, { accept: [204] });
        }
        if (field(read.body, "state") !== "closed") {
            await call("PATCH", path, { body: { state: "closed" } });
        }
        const after = await call("GET", path);
        if (field(after.body, "locked") !== false || field(after.body, "state") !== "closed") {
            throw new Halt(`issue #${String(issue)} reads back locked or open`);
        }
    };

    return {
        async prepare({ template }) {
            originalConfig = await fileAt(CONFIG_PATH);
            const labels = await labelNames();
            originalLabels = labels;
            if (!labels.has(LABELS.ready)) {
                await call("POST", `${repository}/labels`, {
                    body: { name: LABELS.ready, color: "0e8a16" },
                    accept: [201],
                });
            }
            // Marked before sending: a write whose answer is lost may still have landed.
            if (template) {
                if ((await fileAt(TEMPLATE_PATH)) !== null) {
                    throw new Halt(
                        `${TEMPLATE_PATH} already exists; the rehearsal will not overwrite it`,
                    );
                }
                templateCreated = true;
                await put(TEMPLATE_PATH, TEMPLATE, "rehearsal: add a temporary issue form");
            }
            configChanged = true;
            await put(
                CONFIG_PATH,
                ACTIVE_CONFIG,
                "rehearsal: arm triageQueue",
                originalConfig?.sha,
            );
        },

        async hook(url, secret) {
            const answer = await call("POST", `${repository}/hooks`, {
                body: {
                    name: "web",
                    active: true,
                    events: ["issues"],
                    config: { url, content_type: "json", secret, insecure_ssl: "0" },
                },
                accept: [201],
            });
            const id = field(answer.body, "id");
            if (typeof id !== "number") throw new Halt("the created webhook carried no id");
            hookId = id;
            return id;
        },

        adopt(issue) {
            fixtures.push(issue);
        },

        async restore() {
            const problems: string[] = [];
            const attempt = async (what: string, undo: () => Promise<void>): Promise<void> => {
                try {
                    await undo();
                } catch (error) {
                    problems.push(`${what}: ${messageOf(error)}`);
                }
            };
            // The hook goes first, so cleaning up the fixtures delivers nothing.
            if (hookId !== null) {
                const id = hookId;
                await attempt(
                    `delete webhook ${String(id)} in the repository settings`,
                    async () => {
                        await call("DELETE", `${repository}/hooks/${String(id)}`, {
                            accept: [204, 404],
                        });
                        await call("GET", `${repository}/hooks/${String(id)}`, { accept: [404] });
                    },
                );
            }
            for (const issue of fixtures) {
                await attempt(`unlock and close issue #${String(issue)}`, () =>
                    releaseFixture(issue),
                );
            }
            if (configChanged) {
                await attempt(`restore ${CONFIG_PATH} on the default branch`, restoreConfig);
            }
            if (templateCreated) {
                await attempt(`delete ${TEMPLATE_PATH}`, async () => {
                    await remove(TEMPLATE_PATH, "rehearsal: remove the temporary issue form");
                    if ((await fileAt(TEMPLATE_PATH)) !== null)
                        throw new Halt("it still reads back");
                });
            }
            // Unread labels might all be the sandbox's own, so none is deleted.
            for (const name of Object.values(LABELS)) {
                if (originalLabels === null || originalLabels.has(name)) continue;
                await attempt(`delete the label "${name}"`, async () => {
                    const path = `${repository}/labels/${encodeURIComponent(name)}`;
                    await call("DELETE", path, { accept: [204, 404] });
                    await call("GET", path, { accept: [404] });
                });
            }
            return problems;
        },
    };
}
