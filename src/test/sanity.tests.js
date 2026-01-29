import { TestRunner } from "./tester";

export async function runSanityTests(writeOutput) {
	const runner = new TestRunner("JS (WebView) Sanity Tests");

	// Test 1: String operations
	runner.test("String concatenation", (test) => {
		const result = "Hello" + " " + "World";
		test.assertEqual(result, "Hello World", "String concatenation should work");
	});

	// Test 2: Number operations
	runner.test("Basic arithmetic", (test) => {
		const sum = 5 + 3;
		test.assertEqual(sum, 8, "Addition should work correctly");
	});

	// Test 3: Array operations
	runner.test("Array operations", (test) => {
		const arr = [1, 2, 3];
		test.assertEqual(arr.length, 3, "Array length should be correct");
		test.assert(arr.includes(2), "Array should include 2");
	});

	// Test 4: Object operations
	runner.test("Object operations", (test) => {
		const obj = { name: "Test", value: 42 };
		test.assertEqual(obj.name, "Test", "Object property should be accessible");
		test.assertEqual(obj.value, 42, "Object value should be correct");
	});

	// Test 5: Function execution
	runner.test("Function execution", (test) => {
		const add = (a, b) => a + b;
		const result = add(10, 20);
		test.assertEqual(result, 30, "Function should return correct value");
	});

	// Test 6: Async function
	runner.test("Async function handling", async (test) => {
		const asyncFunc = async () => {
			return new Promise((resolve) => {
				setTimeout(() => resolve("done"), 10);
			});
		};

		const result = await asyncFunc();
		test.assertEqual(result, "done", "Async function should work correctly");
	});

	// Test 7: Error handling
	runner.test("Error handling", (test) => {
		try {
			throw new Error("Test error");
		} catch (e) {
			test.assert(e instanceof Error, "Should catch Error instances");
		}
	});

	// Test 8: Conditional logic
	runner.test("Conditional logic", (test) => {
		const value = 10;
		test.assert(value > 5, "Condition should be true");
		test.assert(!(value < 5), "Negation should work");
	});

	// Run all tests
	return await runner.run(writeOutput);
}
