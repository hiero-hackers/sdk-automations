/** `pnpm shell:backup <path>`: copy the store the environment names; exit 1 when it is not there. */

import { existsSync } from "node:fs";
import { Store } from "../../store/index.js";
import { storeFile } from "../paths.js";

const target = process.argv[2];
if (target === undefined || target === "") {
    process.stderr.write("usage: pnpm shell:backup <path>\n");
    process.exit(2);
}
const source = storeFile();
if (!existsSync(source)) {
    process.stderr.write(`no store at ${source}\n`);
    process.exit(1);
}
const store = new Store(source);
try {
    await store.backup(target);
} finally {
    store.close();
}
process.stdout.write(`${source} → ${target}\n`);
