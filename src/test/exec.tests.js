import { TestRunner } from "./tester";

export async function runExecutorTests(writeOutput) {
	const runner = new TestRunner("Executor API Tests");

	runner.test("Executor available", async (test) => {
		test.assert(
			typeof Executor !== "undefined",
			"Executor should be available globally",
		);
	});

	runner.test("Background Executor available", async (test) => {
		test.assert(
			typeof Executor.BackgroundExecutor !== "undefined",
			"Background Executor should be available globally",
		);
	});

	runner.test("execute()", async (test) => {
		test.assert(
			(await Executor.execute("echo test123")).includes("test123"),
			"Command output should match",
		);
	});

	runner.test("execute() (BackgroundExecutor)", async (test) => {
		test.assert(
			(await Executor.BackgroundExecutor.execute("echo test123")).includes(
				"test123",
			),
			"Command output should match",
		);
	});

	runner.test("start()", async (test) => {
		let stdout = "";

		const uuid = await Executor.start("sh", (type, data) => {
			if (type === "stdout") stdout += data;
		});

		await Executor.write(uuid, "echo hello\n");
		await new Promise((r) => setTimeout(r, 200));
		await Executor.stop(uuid);

		await new Promise((r) => setTimeout(r, 200));

		test.assert(stdout.includes("hello"), "Shell should echo output");
	});

	runner.test("start() (BackgroundExecutor)", async (test) => {
		let stdout = "";

		const uuid = await Executor.BackgroundExecutor.start("sh", (type, data) => {
			if (type === "stdout") stdout += data;
		});

		await Executor.BackgroundExecutor.write(uuid, "echo hello\n");
		await new Promise((r) => setTimeout(r, 200));
		await Executor.BackgroundExecutor.stop(uuid);

		await new Promise((r) => setTimeout(r, 200));

		test.assert(stdout.includes("hello"), "Shell should echo output");
	});

	runner.test("start/stop() (BackgroundExecutor)", async (test) => {
		let stdout = "";

		const uuid = await Executor.BackgroundExecutor.start(
			"sh",
			(type, data) => {},
		);

		await new Promise((r) => setTimeout(r, 200));

		const isRunning = await Executor.BackgroundExecutor.isRunning(uuid);

		test.assert(isRunning === true, "Executor must be running");

		await new Promise((r) => setTimeout(r, 200));

		await Executor.BackgroundExecutor.stop(uuid);

		await new Promise((r) => setTimeout(r, 200));

		test.assert(
			isRunning !== (await Executor.BackgroundExecutor.isRunning(uuid)),
			"Executor must be stopped",
		);
		test.assert(
			(await Executor.BackgroundExecutor.isRunning(uuid)) === false,
			"Executor must be stopped",
		);
	});

	runner.test("start/stop()", async (test) => {
		let stdout = "";

		const uuid = await Executor.start("sh", (type, data) => {});

		await new Promise((r) => setTimeout(r, 200));

		const isRunning = await Executor.isRunning(uuid);

		test.assert(isRunning === true, "Executor must be running");

		await new Promise((r) => setTimeout(r, 200));

		await Executor.stop(uuid);

		await new Promise((r) => setTimeout(r, 200));

		test.assert(
			(await Executor.isRunning(uuid)) === false,
			"Executor must be stopped",
		);
	});

	runner.test("FDROID env variable", async (test) => {
		const result = await Executor.execute("echo $FDROID");

		const isSet = result.trim().length > 0;

		test.assert(isSet, "FDROID env variable should be set");
	});

	return await runner.run(writeOutput);
}
