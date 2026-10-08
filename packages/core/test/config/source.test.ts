import { describe, expect, it } from "vitest";
import { ABSENT_CONFIG_REVISION, CONFIG_PATH, revisionOf } from "../../src/config/index.js";

describe("configuration source identity", () => {
    it("shares one path and one absent revision", () => {
        expect(CONFIG_PATH).toBe("automations.yml");
        expect(ABSENT_CONFIG_REVISION).toBe("sha256:absent");
    });
});

describe("a revision is the text's own hash", () => {
    it("names the same text the same way and different text differently", () => {
        expect(revisionOf("mode: observe\n")).toBe(revisionOf("mode: observe\n"));
        expect(revisionOf("mode: observe\n")).not.toBe(revisionOf("mode: dry-run\n"));
        expect(revisionOf("")).toMatch(/^sha256:[0-9a-f]{12}$/);
    });
});
