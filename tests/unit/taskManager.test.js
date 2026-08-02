import { describe, expect, it } from "vitest";
import TaskManager from "utils/taskManager";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TaskManager (linear)", () => {
	it("runs tasks one at a time in queue order", async () => {
		const tm = new TaskManager("linear");
		const order = [];

		const task = (name, ms) => async () => {
			await sleep(ms);
			order.push(name);
			return name;
		};

		const results = await Promise.all([
			tm.queueTask(task("a", 30)),
			tm.queueTask(task("b", 10)),
			tm.queueTask(task("c", 0)),
		]);

		expect(order).toEqual(["a", "b", "c"]);
		expect(results).toEqual(["a", "b", "c"]);
	});

	it("passes an incrementing id to each task", async () => {
		const tm = new TaskManager("linear");
		const ids = await Promise.all([
			tm.queueTask(async (id) => id),
			tm.queueTask(async (id) => id),
			tm.queueTask(async (id) => id),
		]);

		expect(ids).toEqual([0, 1, 2]);
	});

	it("rejects the failed task and continues with the queue", async () => {
		const tm = new TaskManager("linear");

		const failing = tm.queueTask(async () => {
			throw new Error("boom");
		});
		const next = tm.queueTask(async () => "ok");

		await expect(failing).rejects.toThrow("boom");
		await expect(next).resolves.toBe("ok");
	});
});

describe("TaskManager (parallel)", () => {
	it("runs tasks concurrently", async () => {
		const tm = new TaskManager("parallel");
		const order = [];

		await Promise.all([
			tm.queueTask(async () => {
				await sleep(30);
				order.push("slow");
			}),
			tm.queueTask(async () => {
				order.push("fast");
			}),
		]);

		expect(order).toEqual(["fast", "slow"]);
	});

	it("propagates errors to the awaiting caller", async () => {
		const tm = new TaskManager("parallel");

		await expect(
			tm.queueTask(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});
});
