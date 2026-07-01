import {
	clearModifierState,
	clearQuickToolsButtonFeedback,
	removeActionStackEntries,
} from "../handlers/quickToolsState";
import { getLanguageModeRecommendationSearchKeyword } from "../lib/languageModeRecommendations";
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

	runner.test("Language mode recommendation keywords", (test) => {
		test.assertEqual(
			getLanguageModeRecommendationSearchKeyword(".gitignore"),
			"gitignore",
			"Dotfiles without extensions should use the dotfile name",
		);
		test.assertEqual(
			getLanguageModeRecommendationSearchKeyword("src/main.js"),
			"js",
			"Normal files should use the file extension",
		);
		test.assertEqual(
			getLanguageModeRecommendationSearchKeyword("README"),
			"",
			"Extensionless non-dotfiles should not request plugin recommendations",
		);
	});

	runner.test("Quick tools modifier cleanup emits inactive state", (test) => {
		const state = {
			shift: true,
			alt: true,
			ctrl: true,
			meta: true,
		};
		const emitted = [];
		const events = {
			shift: [(value) => emitted.push(["shift", value])],
			alt: [(value) => emitted.push(["alt", value])],
			ctrl: [(value) => emitted.push(["ctrl", value])],
			meta: [(value) => emitted.push(["meta", value])],
		};

		test.assert(clearModifierState(state, events));
		test.assertEqual(state.shift, false);
		test.assertEqual(state.alt, false);
		test.assertEqual(state.ctrl, false);
		test.assertEqual(state.meta, false);
		test.assertEqual(
			JSON.stringify(emitted),
			JSON.stringify([
				["shift", false],
				["alt", false],
				["ctrl", false],
				["meta", false],
			]),
		);
	});

	runner.test(
		"Quick tools feedback cleanup clears stale button state",
		(test) => {
			const container = document.createElement("div");
			const button = document.createElement("button");
			button.className = "icon active click";
			button.dataset.timeout = setTimeout(() => {}, 1000);
			container.append(button);

			test.assertEqual(clearQuickToolsButtonFeedback([container]), 1);
			test.assert(!button.classList.contains("active"));
			test.assert(!button.classList.contains("click"));
			test.assertEqual(button.dataset.timeout, undefined);
		},
	);

	runner.test(
		"Quick tools search cleanup removes duplicate stack entries",
		(test) => {
			const entries = ["search-bar", "other", "search-bar"];
			const stack = {
				remove(id) {
					const index = entries.indexOf(id);
					if (index === -1) return false;
					entries.splice(index, 1);
					return true;
				},
			};

			test.assertEqual(removeActionStackEntries(stack, "search-bar"), 2);
			test.assertEqual(JSON.stringify(entries), JSON.stringify(["other"]));
		},
	);

	// Run all tests
	return await runner.run(writeOutput);
}
