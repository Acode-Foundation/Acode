import FileTree from "../components/fileTree";
import {
	clearModifierState,
	clearQuickToolsButtonFeedback,
	removeActionStackEntries,
} from "../handlers/quickToolsState";
import { getLanguageModeRecommendationSearchKeyword } from "../lib/languageModeRecommendations";
import { isVersionGreater } from "../utils/version";
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

	runner.test(
		"File tree virtualizes one flattened expanded view",
		async (test) => {
			const rootUrl = "memory://workspace";
			const sourceUrl = `${rootUrl}/src`;
			const sourceEntries = Array.from({ length: 500 }, (_, index) => ({
				name: `file-${String(index).padStart(3, "0")}.js`,
				url: `${sourceUrl}/file-${index}.js`,
				isFile: true,
				isDirectory: false,
			}));
			const listings = new Map([
				[
					rootUrl,
					[
						{
							name: "src",
							url: sourceUrl,
							isFile: false,
							isDirectory: true,
						},
						{
							name: "README.md",
							url: `${rootUrl}/README.md`,
							isFile: true,
							isDirectory: false,
						},
					],
				],
				[sourceUrl, sourceEntries],
			]);
			const container = document.createElement("ul");
			container.style.cssText =
				"position:fixed;left:-10000px;top:0;width:280px;height:300px;overflow:auto";
			document.body.append(container);
			const tree = new FileTree(container, {
				getEntries: async (url) => listings.get(url) || [],
			});

			try {
				await tree.load(rootUrl);
				test.assertEqual(tree.visibleEntries.length, 2);
				tree.toggle(sourceUrl, true);
				await new Promise((resolve) => setTimeout(resolve, 0));
				test.assertEqual(tree.visibleEntries.length, 502);
				test.assert(
					tree.virtualList.itemContainer.children.length < 100,
					"Only the viewport and overscan rows should be mounted",
				);
				const idleRows = tree.virtualList.itemContainer.children.length;
				container.dispatchEvent(new Event("touchstart"));
				const interactionRows = tree.virtualList.itemContainer.children.length;
				test.assert(
					interactionRows > idleRows,
					"Touch should pre-paint the Android interaction guard",
				);
				const retainedUrl = tree.visibleEntries[10].url;
				const retainedRow = tree.findElement(retainedUrl);
				container.scrollTop = 13 * 30;
				container.dispatchEvent(new Event("scroll"));
				await new Promise((resolve) => requestAnimationFrame(resolve));
				test.assertEqual(
					tree.findElement(retainedUrl),
					retainedRow,
					"Overlapping rows should stay mounted during incremental scrolling",
				);
				test.assert(
					tree.appendEntry(sourceUrl, "new.js", `${sourceUrl}/new.js`, false),
				);
				test.assertEqual(tree.visibleEntries.length, 503);
				test.assert(tree.removeEntry(`${sourceUrl}/new.js`));
				test.assertEqual(tree.visibleEntries.length, 502);

				tree.toggle(sourceUrl, false);
				test.assertEqual(tree.visibleEntries.length, 2);
			} finally {
				tree.destroy();
				container.remove();
			}
		},
	);

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

	runner.test(
		"Plugin version comparison only accepts newer versions",
		(test) => {
			test.assert(
				isVersionGreater("1.1.2", "1.1.1"),
				"Patch updates should be newer",
			);
			test.assert(
				isVersionGreater("1.2.0", "1.1.9"),
				"Minor updates should be newer",
			);
			test.assert(
				!isVersionGreater("1.1.1", "1.1.1"),
				"Equal versions should not be updates",
			);
			test.assert(
				!isVersionGreater("1.0.0", "1.1.1"),
				"Lower remote versions should not be updates",
			);
		},
	);

	// Run all tests
	return await runner.run(writeOutput);
}
