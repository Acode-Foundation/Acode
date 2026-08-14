import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("account cache", () => {
	beforeEach(() => {
		vi.resetModules();
		const window = new Window({ url: "https://localhost" });
		vi.stubGlobal("window", window);
		vi.stubGlobal("document", window.document);
		vi.stubGlobal("localStorage", window.localStorage);
	});

	it("returns cached account state immediately and retains it offline", async () => {
		const cachedUser = { id: 7, name: "Rohit", email: "rohit@example.com" };
		localStorage.setItem("cached-logged-in-user", JSON.stringify(cachedUser));
		const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
		vi.stubGlobal("fetch", fetchMock);

		const { default: auth } = await import("lib/auth");
		expect(auth.getCachedLoggedInUser()).toEqual(cachedUser);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await auth.getLoggedInUser(true)).toEqual(cachedUser);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
