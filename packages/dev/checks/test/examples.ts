/**
 * The shipped `docs/examples/` files, read through the entry point the shell
 * uses — and the committed value each one parses to.
 *
 * Here rather than in `examples.test.ts` because the snapshots are a
 * GENERATED artifact: `pnpm contracts` rewrites them from the examples the
 * same way it rewrites the tables (`generated.ts` lists them), and the test
 * holds them. One renderer, so the file the runner writes and the value the
 * test compares cannot disagree over an indent — and so the repair for a red
 * snapshot is the command every other generated artifact already names,
 * rather than a `vitest -u` nothing in the repository writes down.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfigDocument, type AdmittedCapability } from "@hiero-hackers/automation-core";
import { shippedCapabilities } from "./capabilities.js";
import { docsDir, exampleFiles } from "./repository.js";

const examplesDir = join(docsDir, "examples");

/** Where one example's committed value lives, repository-relative. */
export function snapshotPath(file: string): string {
    return `packages/dev/checks/test/fixtures/examples/${file.replace(/\.yml$/, ".json")}`;
}

/**
 * The declarations the parser judges a document against: name, the spec each
 * settings block is read against, and the mappings it requires (D84, C1).
 * Read off the shipped list, so an example that configures a capability the
 * shell does not ship fails rather than parsing against a schema nobody ships.
 */
export function admittedCapabilities(): readonly AdmittedCapability[] {
    return (
        shippedCapabilities()
            // With `labels`, as the shell admits them: the block copies rest on it (D204, D244).
            .map(({ name, settings, requiredMappings, labels }) => ({
                name,
                settings,
                requiredMappings,
                labels,
            }))
            // Code-point order, the same `.sort()` `declaredCapabilityNames` uses, so
            // the two lists never disagree about where a capital letter sorts.
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    );
}

/** One example document, parsed as the shell parses it. */
export function parseExample(file: string): ReturnType<typeof parseConfigDocument> {
    return parseConfigDocument(readFileSync(join(examplesDir, file), "utf8"), {
        revision: file,
        knownCapabilities: admittedCapabilities(),
    });
}

/** JSON rather than the serializer's shape: a snapshot a reviewer can read. */
export function snapshotText(config: unknown): string {
    return `${JSON.stringify(config, null, 4)}\n`;
}

/**
 * Every example's committed value, as files to write.
 *
 * An example that does not parse has no value to commit, so it is skipped
 * here and left to the test that says so — the runner's job is to repair a
 * drifted snapshot, never to invent one for a document the parser refuses.
 */
export function exampleSnapshots(): readonly { readonly path: string; readonly text: string }[] {
    const written: { path: string; text: string }[] = [];
    for (const file of exampleFiles()) {
        const result = parseExample(file);
        if (result.ok)
            written.push({ path: snapshotPath(file), text: snapshotText(result.config) });
    }
    return written;
}
