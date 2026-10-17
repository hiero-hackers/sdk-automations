/**
 * How one event is caused on the sandbox as the person: an issue opened, labelled, commented on
 * and closed; a branch with one commit and a pull request from it, then closed. Every fixture is
 * adopted by the sandbox record the moment it exists, and GitHub's clock stamps each step.
 */

import type { ItemRef } from "@hiero-hackers/automation-core";
import { field, Halt, type Answer, type Call } from "../github.js";
import type { Action } from "./cases.js";
import { CONFIG_PATH, type Sandbox } from "./sandbox.js";

const BODY = "Temporary fixture for the action rehearsal.";

/** The items a case's events act on, as they come to exist. */
export interface Subject {
    issue: number | null;
    pull: number | null;
}

/** What a provocation leaves: the item it was about, and GitHub's clock as it began. */
export interface Provoked {
    readonly item: ItemRef;
    readonly since: string;
}

export interface Provoker {
    /** Acts as the person; `name` titles what it creates and names the branch. */
    provoke(action: Action, subject: Subject, name: string): Promise<Provoked>;
}

export interface ProvokerOptions {
    readonly call: Call;
    readonly sandbox: Sandbox;
    readonly owner: string;
    readonly repo: string;
    readonly defaultBranch: string;
}

export function createProvoker(options: ProvokerOptions): Provoker {
    const { call, sandbox, owner, repo, defaultBranch } = options;
    const repository = `/repos/${owner}/${repo}`;

    const numberOf = (answer: Answer, what: string): number => {
        const number = field(answer.body, "number");
        if (typeof number !== "number") throw new Halt(`${what} was created without a number`);
        return number;
    };

    const issueOf = (subject: Subject): number => {
        if (subject.issue === null) throw new Halt("a step acted before its issue was opened");
        return subject.issue;
    };

    const pullOf = (subject: Subject): number => {
        if (subject.pull === null)
            throw new Halt("a step acted before its pull request was opened");
        return subject.pull;
    };

    const open = async (subject: Subject, name: string): Promise<Answer> => {
        const created = await call("POST", `${repository}/issues`, {
            body: { title: name, body: BODY },
            accept: [201],
        });
        subject.issue = numberOf(created, "the issue");
        sandbox.adoptIssue(subject.issue);
        return created;
    };

    /** One commit on a fresh branch: the config file touched, or a file of its own added. */
    const commitOn = async (branch: string, name: string, editsConfig: boolean): Promise<void> => {
        if (!editsConfig) {
            await sandbox.put(`rehearsal/${name}.md`, `# ${name}\n`, `${name}: one commit`, {
                branch,
            });
            return;
        }
        const config = await sandbox.fileAt(CONFIG_PATH, branch);
        if (config === null) throw new Halt(`${CONFIG_PATH} is absent on ${branch}`);
        await sandbox.put(CONFIG_PATH, `${config.text}# ${name}\n`, `${name}: touch the config`, {
            branch,
            sha: config.sha,
        });
    };

    const openPull = async (
        subject: Subject,
        name: string,
        editsConfig: boolean,
    ): Promise<Answer> => {
        const branch = `rehearsal/${name}`;
        const base = await call("GET", `${repository}/git/ref/heads/${defaultBranch}`);
        const sha = field(field(base.body, "object"), "sha");
        if (typeof sha !== "string") throw new Halt(`${defaultBranch} reads back without a commit`);
        // Marked before sending: a write whose answer is lost may still have landed.
        sandbox.adoptBranch(branch);
        await call("POST", `${repository}/git/refs`, {
            body: { ref: `refs/heads/${branch}`, sha },
            accept: [201],
        });
        await commitOn(branch, name, editsConfig);
        const created = await call("POST", `${repository}/pulls`, {
            body: { title: name, head: branch, base: defaultBranch, body: BODY },
            accept: [201],
        });
        subject.pull = numberOf(created, "the pull request");
        sandbox.adoptPull(subject.pull);
        return base;
    };

    const stamped = (answer: Answer, item: ItemRef): Provoked => ({
        item,
        since: answer.date ?? new Date().toISOString(),
    });

    return {
        async provoke(action, subject, name) {
            switch (action.kind) {
                case "open": {
                    const answer = await open(subject, name);
                    return stamped(answer, { kind: "issue", number: issueOf(subject) });
                }
                case "label": {
                    const issue = issueOf(subject);
                    const answer = await call(
                        "POST",
                        `${repository}/issues/${String(issue)}/labels`,
                        {
                            body: { labels: [action.name] },
                        },
                    );
                    return stamped(answer, { kind: "issue", number: issue });
                }
                case "comment": {
                    const issue = issueOf(subject);
                    const answer = await call(
                        "POST",
                        `${repository}/issues/${String(issue)}/comments`,
                        { body: { body: action.body }, accept: [201] },
                    );
                    return stamped(answer, { kind: "issue", number: issue });
                }
                case "close": {
                    const issue = issueOf(subject);
                    const answer = await call("PATCH", `${repository}/issues/${String(issue)}`, {
                        body: { state: "closed" },
                    });
                    return stamped(answer, { kind: "issue", number: issue });
                }
                case "openPull": {
                    const answer = await openPull(subject, name, action.editsConfig);
                    return stamped(answer, { kind: "pullRequest", number: pullOf(subject) });
                }
                case "closePull": {
                    const pull = pullOf(subject);
                    const answer = await call("PATCH", `${repository}/pulls/${String(pull)}`, {
                        body: { state: "closed" },
                    });
                    return stamped(answer, { kind: "pullRequest", number: pull });
                }
            }
        },
    };
}
