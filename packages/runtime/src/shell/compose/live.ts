/**
 * The live fill: credentials in, the seams the shell would otherwise stub out.
 * The one place the composition holds an App's private key, and the only
 * directory of the runtime allowed to reach the adapter at all.
 */

import { readFileSync } from "node:fs";
import type {
    AdmittedCapability,
    Allowance,
    Externals,
    ItemRef,
    PermissionGrant,
    ReadBack,
    RepositoryRef,
} from "@hiero-hackers/automation-core";
import {
    causeFingerprintOf,
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
    readItem,
    staticTokenSource,
    wait,
    type Allowance as ClientAllowance,
    type AppIdentity,
    type FactsReader,
    type OrderingEvidenceOptions,
    type Read,
    type TokenSource,
} from "../../adapter/index.js";
import type { Log } from "../log.js";
import type { SweepFacts } from "../sweep/sweep.js";
import type { Credentials } from "./composition.js";
import type { RepositorySeams } from "./shell.js";

/**
 * The sweep's seam, held against the adapter object that fills it.
 * The ONLY file allowed to see both, so the only place a drift can be caught. A CONSTRAINT rather than a conditional, which would evaluate to `never` and compile.
 */
type Satisfies<Contract, Given extends Contract> = Given;
type _SweepSeamIsTheAdapterSurface = Satisfies<SweepFacts, FactsReader>;

export interface LiveGitHub {
    /** One set per repository, built on demand and held: the installation may deliver for any. */
    seamsFor(repository: RepositoryRef, allowance?: ClientAllowance): RepositorySeams;
    /** The sweep's one allowance, for the process and not for a tick (D192). */
    readonly sweepAllowance: Allowance;
    /** The webhook lane's, holding the share the sweep does not (D192). */
    readonly deliveryAllowance: Allowance;
    /** One item as GitHub holds it now, charged to the webhook lane. */
    readItem(repository: RepositoryRef, item: ItemRef): Promise<Read<Record<string, unknown>>>;
}

/** An App's credentials, or a token minted elsewhere with the identity it acts as. */
export type LiveAuth =
    | { readonly kind: "app"; readonly credentials: Credentials }
    | {
          readonly kind: "token";
          readonly token: {
              readonly value: string;
              readonly expiresAt: Date;
              readonly grants: readonly PermissionGrant[];
          };
          readonly identity: AppIdentity;
      };

/** The record's own fields, plus the seams a record cannot carry. */
export interface LiveOptions {
    readonly auth: LiveAuth;
    readonly writes: { readonly appSlug: string } | null;
    readonly killSwitchActive: boolean;
    readonly clock: () => Date;
    /** What share of each of GitHub's pools the sweep may spend; the rest is the lane's (D192). Ignored when `lanes` is `"one"`. */
    readonly share: number;
    /** `"two"` is the hosted shell's sweep and lane; `"one"` makes `deliveryAllowance` the sweep's own object. */
    readonly lanes?: "two" | "one";
    /** Comments both lanes may create per hour; `null` takes the client's own ceiling. */
    readonly contentCreationHourly: number | null;
    /** The GitHub API origin; absent is api.github.com. */
    readonly apiOrigin?: string;
    /** Handed down because the adapter may not import the capabilities package. */
    readonly knownCapabilities: readonly AdmittedCapability[];
    /** One repository's landed calls, as the adapter's ordering read asks for them (D159). */
    readonly ownWrites: (repository: RepositoryRef) => OrderingEvidenceOptions["ownWrites"];
    readonly log: Log;
}

/** The token source, and the identity the read-back recognises as this process's own. */
function authenticate(
    auth: LiveAuth,
    clock: () => Date,
    apiOrigin: string | undefined,
): {
    readonly tokenSource: TokenSource;
    readonly identityFor: (appSlug: string) => AppIdentity;
    /** The identity known before any write is armed: a token arm names its own. */
    readonly identity: AppIdentity | null;
} {
    if (auth.kind === "token") {
        return {
            tokenSource: staticTokenSource(auth.token),
            identityFor: () => auth.identity,
            identity: auth.identity,
        };
    }
    const { appId, installationId, privateKeyPath } = auth.credentials;
    let privateKeyPem: string;
    try {
        // Stryker disable next-line StringLiteral: an emptied encoding yields the same PEM as a Buffer, which node's signer accepts identically — the mutant is equivalent.
        privateKeyPem = readFileSync(privateKeyPath, "utf8");
    } catch {
        console.error(`PRIVATE_KEY_PATH could not be read: ${privateKeyPath}`);
        process.exit(1);
    }
    return {
        tokenSource: createTokenSource({
            credentials: { appId, installationId, privateKeyPem },
            mint: githubMintInstallationToken(apiOrigin === undefined ? {} : { apiOrigin }),
            clock,
        }),
        identityFor: (appSlug) => ({ appId, botLogin: `${appSlug}[bot]` }),
        identity: null,
    };
}

export function liveGitHub({
    auth,
    writes,
    killSwitchActive,
    clock,
    share,
    lanes = "two",
    contentCreationHourly,
    apiOrigin,
    knownCapabilities,
    ownWrites,
    log,
}: LiveOptions): LiveGitHub {
    const { tokenSource, identityFor, identity } = authenticate(auth, clock, apiOrigin);
    const http = createGitHubHttpClient({
        tokenSource,
        ...(contentCreationHourly === null ? {} : { contentCreationHourly }),
        ...(apiOrigin === undefined ? {} : { apiOrigin }),
    });
    /** The sweep's share of GitHub's pools, for the process. The clock rolls a window nobody can report (D196). */
    const sweepAllowance = createAllowance({
        share: lanes === "one" ? 1 : share,
        clock: () => clock().getTime(),
        onWindow: ({ pool, limit, remaining, resetAt }) => {
            log({ event: "limits", pool, limit, remaining, resetAt });
        },
    });
    /**
     * The webhook lane's: what the sweep leaves of each pool, and no write cap.
     * GitHub's own numbers are one installation's, so only the sweep's says them.
     */
    const deliveryAllowance =
        lanes === "one"
            ? sweepAllowance
            : createAllowance({ share: 1 - share, clock: () => clock().getTime() });

    /** One repository's seams, each built exactly as a one-repository process built them. */
    const seamsIn = (repository: RepositoryRef, allowance: ClientAllowance): RepositorySeams => {
        /** What every read of this seam set is charged to; one lane holds one set. */
        const charged = { allowance };
        const landed = ownWrites(repository);

        /** The item as GitHub holds it, read as the given identity; the absence rule waits a real second. */
        const readerAs = (as: AppIdentity): ReadBack =>
            createReadBack({ http, repository, ...charged, identity: as, clock, sleep: wait });

        /** The applier's externals, built FRESH on every call, excluding the delivery's own cause. */
        const effectExternals = async (payload?: unknown): Promise<Externals> => {
            const grants = await installationGrants(tokenSource);
            if (!grants.ok) {
                throw new Error(
                    `the installation's grants could not be read: ${grants.failure.kind}`,
                );
            }
            const cause = causeFingerprintOf(payload);
            return {
                killSwitchActive,
                installationGrants: grants.grants,
                latestHumanChangeAt: orderingEvidenceSource({
                    http,
                    repository,
                    ownWrites: landed,
                    ...charged,
                    ...(cause === undefined ? {} : { cause }),
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
                          reader: readerAs(identityFor(writes.appSlug)),
                          externals: effectExternals,
                      },
            ...(identity === null ? {} : { reader: readerAs(identity) }),
        };
    };

    const built = new Map<string, RepositorySeams>();
    return {
        sweepAllowance,
        deliveryAllowance,
        readItem: (repository, item) =>
            readItem({ http, repository, allowance: deliveryAllowance }, item),
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
