/**
 * What a run changes on the sandbox, and how each change is put back and read back: the
 * configuration file on the default branch, the triage label, and the fixtures a run opens, that
 * is issues, pull requests and their branches. Each change is recorded as it lands.
 */

import { field, Halt, listOf, messageOf, type Call } from "../github.js";
import { TRIAGE_LABEL } from "./cases.js";

/** The configuration the Action reads, on the default branch. */
export const CONFIG_PATH = "sdk-automations.yml";

/** Where the workflow must sit for GitHub to raise the Action's runs. */
export const WORKFLOW_PATH = ".github/workflows/sdk-automations.yml";

const LABELS_PAGE = 100;

/** A file on a branch: its blob sha, and its text. */
export interface File {
    readonly sha: string;
    readonly text: string;
}

/** What the guards read before anything changes. */
export interface SandboxFacts {
    readonly defaultBranch: string;
    readonly workflowPresent: boolean;
    /** The `mode` the config in force names; `null` where there is no config. */
    readonly configMode: string | null;
}

export interface Sandbox {
    /** Reads what the guards ask, and keeps the config as it is. */
    inspect(): Promise<SandboxFacts>;
    /** Creates the triage label where the sandbox lacks it. */
    prepare(): Promise<void>;
    /** Commits `text` as the config on the default branch; answers the blob sha read back. */
    switchConfig(text: string, message: string): Promise<string>;
    /** A file on a branch, the default one unless `ref` names another; `null` where there is none. */
    fileAt(path: string, ref?: string): Promise<File | null>;
    /** Writes a file on a branch; `sha` is the current blob's where the file exists. */
    put(path: string, text: string, message: string, where: Placement): Promise<void>;
    adoptIssue(issue: number): void;
    adoptPull(pull: number): void;
    adoptBranch(branch: string): void;
    /** Undoes every recorded change; answers each one that could not be read back as undone. */
    restore(): Promise<string[]>;
}

/** Which branch a write lands on, and which blob it replaces. */
export interface Placement {
    readonly branch?: string;
    readonly sha?: string;
}

/** The `mode` a config file names, quoted or not; `null` where it names none. */
export function modeOf(text: string): string | null {
    return /^mode:\s*["']?([A-Za-z-]+)["']?\s*(?:#.*)?$/m.exec(text)?.[1] ?? null;
}

export function createSandbox(call: Call, owner: string, repo: string): Sandbox {
    const repository = `/repos/${owner}/${repo}`;
    let originalConfig: File | null | undefined;
    let configChanged = false;
    let labelCreated = false;
    const issues: number[] = [];
    const pulls: number[] = [];
    const branches: string[] = [];

    const fileAt = async (path: string, ref?: string): Promise<File | null> => {
        const query = ref === undefined ? "" : `?ref=${encodeURIComponent(ref)}`;
        const answer = await call("GET", `${repository}/contents/${path}${query}`, {
            accept: [200, 404],
        });
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
        { branch, sha }: Placement,
    ): Promise<void> => {
        const content = Buffer.from(text, "utf8").toString("base64");
        await call("PUT", `${repository}/contents/${path}`, {
            body: {
                message,
                content,
                ...(branch === undefined ? {} : { branch }),
                ...(sha === undefined ? {} : { sha }),
            },
            accept: [200, 201],
        });
    };

    const labelNames = async (): Promise<Set<string>> => {
        const answer = await call("GET", `${repository}/labels?per_page=${String(LABELS_PAGE)}`);
        const names = listOf(answer, "the label list").map((label) => field(label, "name"));
        if (names.length >= LABELS_PAGE) throw new Halt("the sandbox has a page of labels or more");
        return new Set(names.filter((name): name is string => typeof name === "string"));
    };

    const restoreConfig = async (): Promise<void> => {
        const current = await fileAt(CONFIG_PATH);
        if (originalConfig === null && current !== null) {
            await call("DELETE", `${repository}/contents/${CONFIG_PATH}`, {
                body: {
                    message: "rehearsal: remove the temporary configuration",
                    sha: current.sha,
                },
            });
        } else if (originalConfig && current?.sha !== originalConfig.sha) {
            await put(CONFIG_PATH, originalConfig.text, "rehearsal: restore the configuration", {
                ...(current === null ? {} : { sha: current.sha }),
            });
        }
        const after = await fileAt(CONFIG_PATH);
        if ((after?.sha ?? null) !== (originalConfig?.sha ?? null)) {
            throw new Halt(`${CONFIG_PATH} reads back as ${after?.sha ?? "absent"}`);
        }
    };

    /** Closes an issue or a pull request, both read and patched at `path`, and reads it back. */
    const close = async (path: string): Promise<void> => {
        const read = await call("GET", path);
        if (field(read.body, "state") !== "closed") {
            await call("PATCH", path, { body: { state: "closed" } });
        }
        const after = await call("GET", path);
        if (field(after.body, "state") !== "closed") throw new Halt("it reads back open");
    };

    const deleteBranch = async (branch: string): Promise<void> => {
        await call("DELETE", `${repository}/git/refs/heads/${branch}`, { accept: [204, 422] });
        await call("GET", `${repository}/git/ref/heads/${branch}`, { accept: [404] });
    };

    const deleteLabel = async (): Promise<void> => {
        const path = `${repository}/labels/${encodeURIComponent(TRIAGE_LABEL)}`;
        await call("DELETE", path, { accept: [204, 404] });
        await call("GET", path, { accept: [404] });
    };

    return {
        async inspect() {
            const defaultBranch = field((await call("GET", repository)).body, "default_branch");
            if (typeof defaultBranch !== "string") {
                throw new Halt("the sandbox names no default branch");
            }
            originalConfig = await fileAt(CONFIG_PATH);
            return {
                defaultBranch,
                workflowPresent: (await fileAt(WORKFLOW_PATH)) !== null,
                configMode: originalConfig === null ? null : modeOf(originalConfig.text),
            };
        },

        async prepare() {
            if ((await labelNames()).has(TRIAGE_LABEL)) return;
            // Marked before sending: a write whose answer is lost may still have landed.
            labelCreated = true;
            await call("POST", `${repository}/labels`, {
                body: { name: TRIAGE_LABEL, color: "0e8a16" },
                accept: [201],
            });
        },

        async switchConfig(text, message) {
            if (originalConfig === undefined) throw new Halt("the sandbox was not inspected");
            const current = await fileAt(CONFIG_PATH);
            configChanged = true;
            await put(CONFIG_PATH, text, message, current === null ? {} : { sha: current.sha });
            const after = await fileAt(CONFIG_PATH);
            if (after === null || after.text !== text) {
                throw new Halt(`${CONFIG_PATH} does not read back as written`);
            }
            return after.sha;
        },

        fileAt,

        put,

        adoptIssue(issue) {
            issues.push(issue);
        },

        adoptPull(pull) {
            pulls.push(pull);
        },

        adoptBranch(branch) {
            branches.push(branch);
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
            for (const pull of pulls) {
                await attempt(`close pull request #${String(pull)}`, () =>
                    close(`${repository}/pulls/${String(pull)}`),
                );
            }
            for (const branch of branches) {
                await attempt(`delete the branch ${branch}`, () => deleteBranch(branch));
            }
            for (const issue of issues) {
                await attempt(`close issue #${String(issue)}`, () =>
                    close(`${repository}/issues/${String(issue)}`),
                );
            }
            if (configChanged) {
                await attempt(`restore ${CONFIG_PATH} on the default branch`, restoreConfig);
            }
            if (labelCreated) await attempt(`delete the label "${TRIAGE_LABEL}"`, deleteLabel);
            return problems;
        },
    };
}
