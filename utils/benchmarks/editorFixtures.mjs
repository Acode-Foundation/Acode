export const editorFixtureNames = ["javascript", "html", "wrapped", "long-line"];

export async function cleanupEditorFixture(benchmark, editorManager) {
	if (!benchmark) return false;
	const { file, previousFile } = benchmark;
	const files = editorManager?.files;
	const errors = [];
	try {
		if (previousFile && files?.includes(previousFile)) previousFile.makeActive();
	} catch (error) {
		errors.push(error);
	}
	try {
		if (file && (!files || files.includes(file))) {
			await file.remove(true, {
				ignorePinned: true,
				suppressPanePlaceholder: true,
			});
		}
	} catch (error) {
		errors.push(error);
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) {
		throw new AggregateError(errors, "Editor fixture cleanup failed");
	}
	return true;
}

export function editorFixtureCleanupExpression(globalKey, extraGlobalKeys = []) {
	const globalKeys = [globalKey, ...extraGlobalKeys];
	const deletes = globalKeys
		.map((key) => `delete window[${JSON.stringify(key)}];`)
		.join("\n");
	return `
		(async () => {
			const cleanupEditorFixture = (${cleanupEditorFixture.toString()});
			const benchmark = window[${JSON.stringify(globalKey)}];
			try {
				return await cleanupEditorFixture(benchmark, window.editorManager);
			} finally {
				${deletes}
			}
		})()
	`.trim();
}

export async function cleanupRemoteEditorFixture(
	client,
	globalKey,
	extraGlobalKeys = [],
) {
	const evaluation = await client.call("Runtime.evaluate", {
		expression: editorFixtureCleanupExpression(globalKey, extraGlobalKeys),
		awaitPromise: true,
		returnByValue: true,
	});
	if (evaluation.exceptionDetails) {
		throw new Error(
			evaluation.exceptionDetails.exception?.description ||
				evaluation.exceptionDetails.text,
		);
	}
	return evaluation.result?.value ?? false;
}

export function reportBenchmarkRecovery(benchmarkError, recoveryErrors) {
	if (!recoveryErrors.length) return;
	if (benchmarkError) {
		console.error("Benchmark recovery failed:", ...recoveryErrors);
		return;
	}
	throw new AggregateError(recoveryErrors, "Benchmark recovery failed");
}

export function installBenchmarkInterruptRecovery(recover, processTarget = process) {
	let handling = false;
	const handlers = new Map();
	const remove = () => {
		for (const [signal, handler] of handlers) {
			processTarget.off(signal, handler);
		}
	};
	for (const signal of ["SIGINT", "SIGTERM"]) {
		const handler = () => {
			if (handling) return;
			handling = true;
			remove();
			Promise.resolve(recover(signal))
				.catch((error) => {
					console.error("Benchmark interrupt recovery failed:", error);
				})
				.finally(() => processTarget.kill(processTarget.pid, signal));
		};
		handlers.set(signal, handler);
		processTarget.once(signal, handler);
	}
	return remove;
}

export function createEditorFixture(fixture, lineCount) {
	if (fixture === "html") {
		const text = Array.from({ length: lineCount }, (_, index) => {
			const row = Math.floor(index / 8) + 1;
			switch (index % 8) {
				case 0:
					return "<style>";
				case 1:
					return ".row-" + row + " { color: rgb(" + (row % 255) + ", 80, 120); }";
				case 2:
					return "</style>";
				case 3:
					return '<div class="row-' + row + '" data-value="' + row + '">{{ value' + row + " }}</div>";
				case 4:
					return "<script>";
				case 5:
					return 'const value' + row + ' = "row-' + row + '";';
				case 6:
					return "document.querySelector(\".row-" + row + "\")?.classList.add(value" + row + ");";
				default:
					return "</script>";
			}
		}).join("\n");
		return { name: "__cm_render_html__.html", text };
	}
	if (fixture === "wrapped") {
		const text = Array.from({ length: lineCount }, (_, index) => {
			const row = index + 1;
			return "const wrapped" + row + ' = "' + "content ".repeat(30) + row + '";';
		}).join("\n");
		return { name: "__cm_render_wrapped__.js", text };
	}
	if (fixture === "long-line") {
		const rows = Math.min(lineCount, 2000);
		const text = Array.from({ length: rows }, (_, index) => {
			const row = index + 1;
			return "const long" + row + ' = "' + "x".repeat(8000) + '";';
		}).join("\n");
		return { name: "__cm_render_long-line__.js", text };
	}
	const text = Array.from({ length: lineCount }, (_, index) => {
		const row = index + 1;
		return "const v" + row + " = fn(" + row + ', "x"); // ' + row;
	}).join("\n");
	return { name: "__cm_render_javascript__.js", text };
}
