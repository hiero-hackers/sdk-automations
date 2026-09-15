/**
 * The live fill: credentials in, the seams the shell would otherwise stub out.
 * The one place the composition holds an App's private key, and the only
 * directory of the runtime allowed to reach the adapter at all.
 */

import { readFileSync } from "node:fs";
import type { AdmittedCapability, Externals, RepositoryRef } from "@hiero-hackers/automation-core";
import {
    createAllowance,
    createFactsReader,
    createGitHubHttpClient,
    createReadBack,
    createTokenSource,
    createWriteVerbs,
    githubConfigSource,
    githubMintInstallationToken,
    installationGrants,
    liveExternalsForDelivery,
    orderingEvidenceSource,
    wait,
    type Allowance as ClientAllowance,
    type FactsReader,
    type OrderingEvidenceOptions,
    type ReadBack,
    type WriteVerbs,
} from "../../adapter/index.js";
import type { Allowance } from "../allowance.js";
import type { EffectReader, EffectWriter } from "../apply/apply.js";
import type { Log } from "../log.js";
import type { SweepFacts } from "../sweep/sweep.js";
import type { Credentials } from "./composition.js";
import type { RepositorySeams } from "./shell.js";

/**
 * The applier's seams, held against the adapter objects that fill them.
 * The ONLY file allowed to see both, so the only place a drift can be caught. A CONSTRAINT rather than a conditional, which would evaluate to `never` and compile.
 */
type Satisfies<Contract, Given extends Contract> = Given;
type _WriterSeamIsTheAdapterSurface = Satisfies<EffectWriter, WriteVerbs>;
type _ReaderSeamIsTheAdapterSurface = Satisfies<EffectReader, ReadBack>;
type _SweepSeamIsTheAdapterSurface = Satisfies<SweepFacts, FactsReader>;
type _AllowanceIsTheClientLedger = Satisfies<Allowance, ClientAllowance>;

export interface LiveGitHub {
    /** One set per repository, built on demand and held: the installation may deliver for any. */
    seamsFor(repository: RepositoryRef, allowance?: ClientAllowance): RepositorySeams;
    /** The sweep's one allowance, for the process and not for a tick (D192). */
    readonly sweepAllowance: Allowance;
    /** The webhook lane's, holding the share the sweep does not (D192). */
    readonly deliveryAllowance: Allowance;
}

/** The record's own fields, plus the seams a record cannot carry. */
export interface LiveOptions {
    readonly credentials: Credentials;
    readonly writes: { readonly appSlug: string } | null;
    readonly killSwitchActive: boolean;
    readonly clock: () => Date;
    /** What share of each of GitHub's pools the sweep may spend; the rest is the lane's (D192). */
    readonly share: number;
    /** Comments both lanes may create per hour; `null` takes the client's own ceiling. */
    readonly contentCreationHourly: number | null;
    /** Handed down because the adapter may not import the capabilities package. */
    readonly knownCapabilities: readonly AdmittedCapability[];
    /** One repository's landed calls, as the adapter's ordering read asks for them (D159). */
    readonly ownWrites: (repository: RepositoryRef) => OrderingEvidenceOptions["ownWrites"];
    readonly log: Log;
}

export function liveGitHub({
    credentials: { appId, installationId, privateKeyPath },
    writes,
    killSwitchActive,
    clock,
    share,
    contentCreationHourly,
    knownCapabilities,
    ownWrites,
    log,
}: LiveOptions): LiveGitHub {
    let privateKeyPem: string;
    try {
        // Stryker disable next-line StringLiteral: an emptied encoding yields the same PEM as a Buffer, which node's signer accepts identically — the mutant is equivalent.
        privateKeyPem = readFileSync(privateKeyPath, "utf8");
    } catch {
        console.error(`PRIVATE_KEY_PATH could not be read: ${privateKeyPath}`);
        process.exit(1);
    }
    const tokenSource = createTokenSource({
        credentials: { appId, installationId, privateKeyPem },
        mint: githubMintInstallationToken(),
        clock,
    });
    const http = createGitHubHttpClient({
        tokenSource,
        ...(contentCreationHourly === null ? {} : { contentCreationHourly }),
    });
    /** The sweep's share of GitHub's pools, for the process. */
    const sweepAllowance = createAllowance({
        share,
        onWindow: ({ pool, limit, remaining, resetAt }) => {
            log({ event: "limits", pool, limit, remaining, resetAt });
        },
    });
    /**
     * The webhook lane's: what the sweep leaves of each pool, and no write cap.
     * GitHub's own numbers are one installation's, so only the sweep's says them.
     */
    const deliveryAllowance = createAllowance({ share: 1 - share });

    /** One repository's seams, each built exactly as a one-repository process built them. */
    const seamsIn = (repository: RepositoryRef, allowance: ClientAllowance): RepositorySeams => {
        /** What every read of this seam set is charged to; one lane holds one set. */
        const charged = { allowance };
        const landed = ownWrites(repository);

        /**
         * The applier's externals, built FRESH on every call (`EffectExternalsSource`).
         * No cause fingerprint is excluded — a known over-refusal, since the seam carries no cause: refusing a write it could have made beats writing over a human's edit.
         */
        const effectExternals = async (): Promise<Externals> => {
            const grants = await installationGrants(tokenSource);
            if (!grants.ok) {
                throw new Error(
                    `the installation's grants could not be read: ${grants.failure.kind}`,
                );
            }
            return {
                killSwitchActive,
                installationGrants: grants.grants,
                latestHumanChangeAt: orderingEvidenceSource({
                    http,
                    repository,
                    ownWrites: landed,
                    ...charged,
                }),
            };
        };

        return {
            facts: (config, groups) =>
                createFactsReader({ http, repository, config, clock, groups, ...charged }),
            configSource: githubConfigSource({ client: http, repository, ...charged }),
            // One call per delivery, so the seam below is bound to that delivery.

            externals: async ({ payload, deliveryId, config }) => {
                const outcome = await liveExternalsForDelivery(
                    {
                        tokenSource,
                        http,
                        repository,
                        config,
                        knownCapabilities,
                        ...charged,
                        ownWrites: landed,
                        onUnknownOrdering: (detail) => {
                            log({ event: "orderingUnknown", deliveryId, detail });
                        },
                    },
                    payload,
                );
                // Stryker disable next-line all: see above — no arrangement of the composition lets a test reach this branch; the config read fails on the same token first.
                // The config read always runs first on the same token source, so every way of
                // breaking the token surfaces there; this guards a token dying between reads.

                if (!outcome.ok) {
                    // Stryker disable next-line all: as above.
                    throw new Error(`live externals unavailable: ${outcome.failure.kind}`);
                }
                return { killSwitchActive, ...outcome.facts };
            },
            writePath:
                writes === null
                    ? null
                    : {
                          writer: createWriteVerbs({ http, repository }),
                          reader: createReadBack({
                              http,
                              repository,
                              ...charged,
                              // Both halves of the one App registration this process already holds.

                              identity: { appId, botLogin: `${writes.appSlug}[bot]` },
                              clock,
                              // The read-back's absence rule is a real second apart, so production waits it.

                              sleep: wait,
                          }),
                          externals: effectExternals,
                      },
        };
    };

    const built = new Map<string, RepositorySeams>();
    return {
        sweepAllowance,
        deliveryAllowance,
        // Held seams are the webhook lane's, and spend its allowance; the sweep passes its own.

        seamsFor: (repository, allowance) => {
            if (allowance !== undefined) return seamsIn(repository, allowance);
            const key = `${repository.owner}/${repository.repo}`;
            const held = built.get(key) ?? seamsIn(repository, deliveryAllowance);
            built.set(key, held);
            return held;
        },
    };
}
