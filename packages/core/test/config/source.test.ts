import { describe, expect, it } from "vitest";
import { ABSENT_CONFIG_REVISION, CONFIG_PATH, revisionOf } from "../../src/config/index.js";

describe("configuration source identity", () => {
    it("shares one path and one absent revision", () => {
        expect(CONFIG_PATH).toBe("sdk-automations.yml");
        expect(ABSENT_CONFIG_REVISION).toBe("sha256:absent");
    });
});

describe("a revision is the text's own hash", () => {
    it("names the same text the same way and different text differently", () => {
        expect(revisionOf("schemaVersion: 1\n")).toBe(revisionOf("schemaVersion: 1\n"));
        expect(revisionOf("schemaVersion: 1\n")).not.toBe(revisionOf("schemaVersion: 2\n"));
        expect(revisionOf("")).toMatch(/^sha256:[0-9a-f]{12}$/);
    });
});
