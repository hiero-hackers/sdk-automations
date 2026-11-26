/**
 * The adapter: the only place in the platform that talks to GitHub.
 * Named exports, deliberately — the surface is what a composition root composes.
 * See [README.md](README.md) for what it owns and the seams it fills.
 */

export { signAppAssertion, type AppCredentials } from "./client/jwt.js";
export { githubMintInstallationToken, type GitHubMintOptions } from "./client/mint.js";
export { githubConfigSource, type GitHubConfigSourceOptions } from "./reads/config.js";
export { createResolverSource, type ResolverSourceOptions } from "./reads/resolvers.js";
export {
    CONFIRMED_SWEEP_READS,
    createFactsReader,
    GROUP_READS,
    SWEEP_READS,
    type ClosedIssues,
    type FactsReader,
    type FactsReaderOptions,
    type OpenItem,
    type OpenItemsOutcome,
    type Read,
    type SweepRead,
} from "./reads/facts.js";
export { readItem } from "./reads/items.js";
export {
    causeFingerprintOf,
    installationGrants,
    liveExternalsForDelivery,
    orderingEvidenceSource,
    type CauseFingerprint,
    type GrantsOutcome,
    type LiveExternalFacts,
    type LiveExternalsOptions,
    type LiveExternalsOutcome,
    type OrderingEvidenceOptions,
} from "./reads/externals.js";
export {
    createTokenSource,
    grantsFromPermissions,
    isWellFormedTokenOutcome,
    staticTokenSource,
    type InstallationToken,
    type StaticTokenOptions,
    type MintInstallationToken,
    type TokenOutcome,
    type TokenSource,
    type TokenSourceOptions,
} from "./client/token.js";
export { createWriteVerbs, type WriteVerbsOptions } from "./writes/writes.js";
export { createReadBack, type AppIdentity, type ReadBackOptions } from "./writes/readback.js";
export {
    type BrokenSeam,
    type FetchLike,
    type GitHubFailure,
    type GitHubHttpClient,
    type GitHubHttpClientOptions,
    type GitHubHttpFailureClass,
    type GitHubOutcome,
    type GitHubRequest,
    type GitHubSuccess,
    type GitHubWriteRequest,
    type NotSentReason,
    type RateLimitSnapshot,
    type WriteIdempotency,
} from "./client/contract.js";
export { type WriteEndpoint } from "./client/endpoints.js";
export { CONTENT_CREATION_HOURLY, createGitHubHttpClient, wait } from "./client/http.js";
export {
    costOf,
    createAllowance,
    type Allowance,
    type AllowanceOptions,
    type Exchange,
    type PoolWindow,
} from "./client/allowance.js";
