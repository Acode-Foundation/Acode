import { rm } from "node:fs/promises";

await Promise.all(
	["www", "lib", "esm"].map((directory) =>
		rm(directory, { force: true, recursive: true }),
	),
);
