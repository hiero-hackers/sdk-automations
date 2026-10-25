/**
 * What a run changes on the sandbox, and how each change is put back and read back: the
 * configuration file, the repository variables that arm and pin it, the workflow's state, the
 * labels, and the fixtures a run opens. Each change is recorded as it lands.
 */

import { field, Halt, listOf, messageOf, type Call } from "../github.js";
import { setTimeout as delay } from "node:timers/promises";
import { TRIAGE_LABEL } from "./cases.js";

/** The configuration the Action reads, on the default branch. */
export const CONFIG_PATH = "sdk-automations.yml";

/** Where the workflow must sit for GitHub to raise the Action's runs. */
export const WORKFLOW_PATH = ".github/workflows/sdk-automations.yml";

/** The repository variables the sandbox's workflow reads. */
export const ARM_VARIABLE = "ARM_WRITES";

export const REF_VARIABLE = "SDK_AUTOMATIONS_REF";

/** The dispatch inputs that run a schedule sweep; the workflow's defaults replay a capture. */
export const SWEEP_INPUTS: Readonly<Record<string, string>> = {
    capture: "",
    event: "schedule",
    number: "",
};

const WORKFLOW_FILE = WORKFLOW_PATH.split("/").at(-1) ?? WORKFLOW_PATH;

const LABELS_PAGE = 100;

/** Between closes once a run leaves more than a few issues behind. */
const CLOSE_PACE_MS = 800;

const BULK_CLOSES = 20;

/** A contents read can lag its write, so a read-back tries this many times before it disagrees. */
const READ_BACK_TRIES = 5;

const READ_BACK_PACE_MS = 1_000;

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
    /** The repository variables as set; `null` where there is none. */
    readonly armWrites: string | null;
    readonly engineRef: string | null;
}

export interface Sandbox {
    /** Reads what the guards ask, and keeps the config as it is. */
    inspect(): Promise<SandboxFacts>;
    /** Creates the triage label where the sandbox lacks it. */
    prepare(): Promise<void>;
    /** Creates a label where the sandbox lacks it; a label it made is deleted on restore. */
    ensureLabel(name: string): Promise<void>;
    /** Sets a repository variable, remembering what it held. */
    setVariable(name: string, value: string): Promise<void>;
    /** Enables or disables the workflow; it is enabled on restore. */
    setWorkflow(enabled: boolean): Promise<void>;
    /** Starts the workflow by hand on the default branch, a sweep unless `inputs` say otherwise; answers when the run was created. */
    dispatch(inputs?: Readonly<Record<string, string>>): Promise<string>;
    /** Sets `ARM_WRITES=true` and commits `text` as the config with `mode: active`. */
    arm(text: string, message: string): Promise<string>;
    /** Closes an issue now and reads it back; it is no longer the restore's to close. */
    closeIssue(issue: number): Promise<void>;
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

/** The config text with its top-level `mode` set. */
export function withMode(text: string, mode: string): string {
    return /^mode:.*$/m.test(text)
        ? text.replace(/^mode:.*$/m, `mode: ${mode}`)
        : `mode: ${mode}\n${text}`;
}

export function createSandbox(call: Call, owner: string, repo: string): Sandbox {
    const repository = `/repos/${owner}/${repo}`;
    let originalConfig: File | null | undefined;
    let configChanged = false;
    const labelsCreated: string[] = [];
    const variables = new Map<string, string | null>();
    let sandboxBranch = "";
    let workflowDisabled = false;
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

    /** The config once `holds` accepts it, or the last read when the tries run out. */
    const readConfigUntil = async (holds: (file: File | null) => boolean): Promise<File | null> => {
        let file = await fileAt(CONFIG_PATH);
        for (let tried = 1; tried < READ_BACK_TRIES && !holds(file); tried++) {
            await delay(READ_BACK_PACE_MS);
            file = await fileAt(CONFIG_PATH);
        }
        return file;
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

    const variableAt = async (name: string): Promise<string | null> => {
        const answer = await call("GET", `${repository}/actions/variables/${name}`, {
            accept: [200, 404],
        });
        const held = field(answer.body, "value");
        return answer.status === 404 || typeof held !== "string" ? null : held;
    };

    const writeVariable = async (name: string, value: string | null): Promise<void> => {
        const path = `${repository}/actions/variables/${name}`;
        const held = await variableAt(name);
        if (value === null) {
            if (held !== null) await call("DELETE", path, { accept: [204] });
        } else if (held === null) {
            await call("POST", `${repository}/actions/variables`, {
                body: { name, value },
                accept: [201],
            });
        } else if (held !== value) {
            await call("PATCH", path, { body: { name, value }, accept: [204] });
        }
        if ((await variableAt(name)) !== value) throw new Halt(`${name} does not read back`);
    };

    const restoreVariables = async (): Promise<void> => {
        for (const [name, original] of [...variables]) {
            await writeVariable(name, original ?? (name === ARM_VARIABLE ? "false" : null));
            variables.delete(name);
        }
    };

    const setWorkflow = async (enabled: boolean): Promise<void> => {
        workflowDisabled = workflowDisabled || !enabled;
        const verb = enabled ? "enable" : "disable";
        await call("PUT", `${repository}/actions/workflows/${WORKFLOW_FILE}/${verb}`, {
            accept: [204],
        });
        const state = field(
            (await call("GET", `${repository}/actions/workflows/${WORKFLOW_FILE}`)).body,
            "state",
        );
        if ((state === "active") !== enabled)
            throw new Halt(`the workflow reads back ${String(state)}`);
        if (enabled) workflowDisabled = false;
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
        const restored = (file: File | null) =>
            (file?.sha ?? null) === (originalConfig?.sha ?? null);
        const after = await readConfigUntil(restored);
        if (!restored(after)) {
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

    const deleteLabel = async (name: string): Promise<void> => {
        const path = `${repository}/labels/${encodeURIComponent(name)}`;
        await call("DELETE", path, { accept: [204, 404] });
        await call("GET", path, { accept: [404] });
    };

    const ensureLabel = async (name: string): Promise<void> => {
        if ((await labelNames()).has(name)) return;
        // Marked before sending: a write whose answer is lost may still have landed.
        labelsCreated.push(name);
        await call("POST", `${repository}/labels`, {
            body: { name, color: "0e8a16" },
            accept: [201],
        });
    };

    const switchConfig = async (text: string, message: string): Promise<string> => {
        if (originalConfig === undefined) throw new Halt("the sandbox was not inspected");
        const current = await fileAt(CONFIG_PATH);
        configChanged = true;
        await put(CONFIG_PATH, text, message, current === null ? {} : { sha: current.sha });
        const written = (file: File | null): file is File => file?.text === text;
        const after = await readConfigUntil(written);
        if (!written(after)) throw new Halt(`${CONFIG_PATH} does not read back as written`);
        return after.sha;
    };

    const setVariable = async (name: string, value: string): Promise<void> => {
        // Marked before sending: a write whose answer is lost may still have landed.
        if (!variables.has(name)) variables.set(name, await variableAt(name));
        await writeVariable(name, value);
    };

    return {
        async inspect() {
            const branch = field((await call("GET", repository)).body, "default_branch");
            if (typeof branch !== "string") throw new Halt("the sandbox names no default branch");
            sandboxBranch = branch;
            originalConfig = await fileAt(CONFIG_PATH);
            return {
                defaultBranch: branch,
                workflowPresent: (await fileAt(WORKFLOW_PATH)) !== null,
                configMode: originalConfig === null ? null : modeOf(originalConfig.text),
                armWrites: await variableAt(ARM_VARIABLE),
                engineRef: await variableAt(REF_VARIABLE),
            };
        },

        prepare: () => ensureLabel(TRIAGE_LABEL),

        ensureLabel,

        setVariable,

        setWorkflow,

        async dispatch(inputs = SWEEP_INPUTS) {
            const path = `${repository}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
            // GitHub answered 204 for years and now answers 200 naming the run it raised. That
            // run was created before the answer, so its own clock is the moment to watch from.
            const answer = await call("POST", path, {
                body: { ref: sandboxBranch, inputs },
                accept: [200, 204],
            });
            const raised = field(answer.body, "workflow_run_id");
            if (typeof raised === "number") {
                const run = await call("GET", `${repository}/actions/runs/${String(raised)}`);
                const created = field(run.body, "created_at");
                if (typeof created === "string") return created;
            }
            return answer.date ?? new Date().toISOString();
        },

        async arm(text, message) {
            const sha = await switchConfig(withMode(text, "active"), message);
            await setVariable(ARM_VARIABLE, "true");
            return sha;
        },

        async closeIssue(issue) {
            await close(`${repository}/issues/${String(issue)}`);
            issues.splice(issues.indexOf(issue), 1);
        },

        switchConfig,

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
            // Disarmed before anything is closed: a closing event must not meet a live config.
            await attempt("restore the repository variables", restoreVariables);
            if (configChanged) {
                await attempt(`restore ${CONFIG_PATH} on the default branch`, async () => {
                    await restoreConfig();
                    configChanged = false;
                });
            }
            for (const pull of pulls.splice(0)) {
                await attempt(`close pull request #${String(pull)}`, () =>
                    close(`${repository}/pulls/${String(pull)}`),
                );
            }
            for (const branch of branches.splice(0)) {
                await attempt(`delete the branch ${branch}`, () => deleteBranch(branch));
            }
            const bulk = issues.length > BULK_CLOSES;
            for (const issue of issues.splice(0)) {
                await attempt(`close issue #${String(issue)}`, () =>
                    close(`${repository}/issues/${String(issue)}`),
                );
                if (bulk) await delay(CLOSE_PACE_MS);
            }
            if (workflowDisabled) {
                await attempt("enable the workflow", () => setWorkflow(true));
            }
            for (const name of labelsCreated.splice(0)) {
                await attempt(`delete the label "${name}"`, () => deleteLabel(name));
            }
            return problems;
        },
    };
}
