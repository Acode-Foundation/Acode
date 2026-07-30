const assert = require("node:assert/strict");
const test = require("node:test");
const { getAppVariant } = require("./dev");

test("recognizes the free app variant", () => {
	assert.equal(getAppVariant(["android", "free"]), "free");
	assert.equal(getAppVariant(["FREE", "--emulator"]), "free");
});

test("does not change the app variant when free is omitted", () => {
	assert.equal(getAppVariant([]), null);
	assert.equal(getAppVariant(["android", "--emulator"]), null);
});
