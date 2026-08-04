import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "vitest";

const requireFromTest = createRequire(import.meta.url);
const { getAppVariant } = requireFromTest("../../utils/scripts/dev.js");

test("recognizes the explicit free variant case-insensitively", () => {
	assert.equal(getAppVariant(["android", "free"]), "free");
	assert.equal(getAppVariant(["FREE", "--emulator"]), "free");
});

test("defaults to paid when free is not specified", () => {
	assert.equal(getAppVariant([]), "paid");
	assert.equal(getAppVariant(["android", "--emulator"]), "paid");
	assert.equal(getAppVariant(["android", "paid"]), "paid");
	assert.equal(getAppVariant(["PAID", "--emulator"]), "paid");
});
