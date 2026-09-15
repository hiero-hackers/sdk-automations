/**
 * The live configuration read: `automations.yml` at the repository's default branch.
 * Absence is re-corroborated on every load, deliberately unmemoized (D51, D122).
 */

import { Buffer } from "node:buffer";
import {
    ABSENT_CONFIG_REVISION,
    CONFIG_PATH,
    type ConfigLoadOutcome,
    type ConfigSource,
    type RepositoryRef,
    revisionOf,
} from "@hiero-hackers/automation-core";
import type { Allowance } from "../client/allowance.js";
import { repoPath, type GitHubHttpClient } from "../client/contract.js";
import { field, jsonRecordOf } from "../client/untrusted.js";

/** Seams the composition root supplies. */
export interface GitHubConfigSourceOptions {
    readonly client: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** The lane this read is charged to; a lane with none is charged nowhere (D192). */
    readonly allowance?: Allowance;
}

const BLOB_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * A document, a defect of the committed file, or a shape we do not know.
 * Exported with its decoder: `configAtHead` reads the same endpoint at another ref.
 */
export type DecodedContents =
    | { readonly kind: "document"; readonly revision: string; readonly text: string }
    | { readonly kind: "defective"; readonly detail: string; readonly revision: string }
    | { readonly kind: "unrecognized" };

export function decodeContents(body: string): DecodedContents {
    const response = jsonRecordOf(body);
    const sha = field(response, "sha");
    // Stryker disable next-line ConditionalExpression,LogicalOperator: field() answers undefined on null and test() stringifies non-strings to a miss — the leading arms are for readers.
    if (response === null || typeof sha !== "string" || !BLOB_SHA.test(sha)) {
        return { kind: "unrecognized" };
    }
    const type = field(response, "type");
    if (type !== "file") {
        return {
            kind: "defective",
            detail: `the config path is not a file (type ${String(type)})`,
            revision: `git:${sha}`,
        };
    }
    const content = field(response, "content");
    // GitHub answers `encoding: "none"` with empty content over 1 MB.
    if (field(response, "encoding") !== "base64" || typeof content !== "string") {
        return {
            kind: "defective",
            detail: "the config file's content is not retrievable inline (too large?)",
            revision: `git:${sha}`,
        };
    }
    const encoded = content.replace(/[\r\n]/g, "");
    try {
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.toString("base64") !== encoded) {
            return {
                kind: "defective",
                detail: "the config file's content is not valid base64",
                revision: `git:${sha}`,
            };
        }
        /**
         * The content hash, not the blob sha: the same text yields the same revision (D122).
         * The WHATWG default drops a leading BOM, matched by `fileConfigSource`.
         */
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { kind: "document", revision: revisionOf(text), text };
    } catch {
        return {
            kind: "defective",
            detail: "the config file is not valid UTF-8",
            revision: `git:${sha}`,
        };
    }
}

export function githubConfigSource({
    client,
    repository,
    allowance,
}: GitHubConfigSourceOptions): ConfigSource {
    const repoUrl = repoPath(repository);
    const configUrl = `${repoUrl}/contents/${CONFIG_PATH}`;

    /** A bare 404 proves nothing; only a visible repository makes it absence. */
    const corroboratedAbsence = async (): Promise<ConfigLoadOutcome> => {
        const repo = await client.request({ method: "GET", url: repoUrl }, allowance);
        if (repo.ok) {
            return { ok: true, document: { revision: ABSENT_CONFIG_REVISION, text: "" } };
        }
        return {
            ok: false,
            permanent: false,
            detail: "config 404 without a visible repository — access, not absence",
        };
    };

    return {
        async load(): Promise<ConfigLoadOutcome> {
            const outcome = await client.request({ method: "GET", url: configUrl }, allowance);
            if (!outcome.ok) {
                return outcome.failure.kind === "notFoundOrNotInstalled"
                    ? corroboratedAbsence()
                    : {
                          ok: false,
                          permanent: false,
                          detail: `config read failed: ${outcome.failure.kind}`,
                      };
            }
            const decoded = decodeContents(outcome.body);
            switch (decoded.kind) {
                case "document":
                    return {
                        ok: true,
                        document: { revision: decoded.revision, text: decoded.text },
                    };
                case "defective":
                    return {
                        ok: false,
                        permanent: true,
                        detail: decoded.detail,
                        revision: decoded.revision,
                    };
                case "unrecognized":
                    return {
                        ok: false,
                        permanent: false,
                        detail: "unrecognized contents response shape",
                    };
            }
        },
    };
}
