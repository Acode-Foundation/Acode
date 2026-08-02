const assert = require("node:assert/strict");
const test = require("node:test");
const { getAppVariant } = require("./dev");

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
