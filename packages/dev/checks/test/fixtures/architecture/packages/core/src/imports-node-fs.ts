// core-and-probes-stay-pure: decide() does no I/O; a filesystem import is the leak.
export { readFileSync as coreReadsDisk } from "node:fs";
