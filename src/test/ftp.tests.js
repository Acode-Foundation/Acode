import fsOperation from "fileSystem";
import Url from "utils/Url";
import { SkipTest, TestRunner } from "./tester";

export async function runFtpTests(writeOutput) {
	const runner = new TestRunner("FTP API Tests");

	const testDir = window.FTP_TEST_URL;

	runner.test("FTP_TEST_URL is defined", (test) => {
		if (!testDir) {
			throw new SkipTest(
				"window.FTP_TEST_URL is not defined. Set it to run FTP tests.",
			);
		}
		test.assert(typeof testDir === "string", "FTP_TEST_URL should be a string");
		test.assert(
			testDir.startsWith("ftp://"),
			"FTP_TEST_URL should start with ftp://",
		);
	});

	runner.test("fsOperation returns a FileSystem object for FTP", (test) => {
		if (!testDir) throw new SkipTest("No FTP_TEST_URL");
		const fs = fsOperation(testDir);
		test.assert(fs !== null, "fsOperation should return filesystem handler");
		test.assert(
			typeof fs.createFile === "function",
			"createFile should be a function",
		);
		test.assert(typeof fs.exists === "function", "exists should be a function");
	});

	runner.test(
		"FTP: createFile, exists, writeFile, readFile, delete",
		async (test) => {
			if (!testDir) throw new SkipTest("No FTP_TEST_URL");

			const fs = fsOperation(testDir);
			const filename = `__ftp_test_${Date.now()}__.txt`;
			const fileUrl = Url.join(testDir, filename);

			try {
				// 1. Create the file
				const createdUrl = await fs.createFile(filename, "ftp test content");
				test.assertEqual(
					createdUrl,
					fileUrl,
					"Created file URL should match expected path",
				);

				// 2. Check existence
				const fileFs = fsOperation(createdUrl);
				const exists = await fileFs.exists();
				test.assertEqual(exists, true, "Created file should exist on FTP");

				// 3. Read content
				const content = await fileFs.readFile("utf-8");
				test.assertEqual(
					content,
					"ftp test content",
					"Read content should match",
				);

				// 4. Write new content
				await fileFs.writeFile("updated ftp content");
				const updatedContent = await fileFs.readFile("utf-8");
				test.assertEqual(
					updatedContent,
					"updated ftp content",
					"Read content should match updated content",
				);

				// 5. Stat check
				const stat = await fileFs.stat();
				test.assert(stat !== null, "Stat should not be null");
				test.assertEqual(stat.isFile, true, "Stat should show isFile true");
				test.assertEqual(
					stat.isDirectory,
					false,
					"Stat should show isDirectory false",
				);

				// 6. Delete file
				await fileFs.delete();
				const existsAfterDelete = await fileFs.exists();
				test.assertEqual(
					existsAfterDelete,
					false,
					"File should not exist after deletion",
				);
			} catch (error) {
				try {
					const fileFs = fsOperation(fileUrl);
					if (await fileFs.exists()) {
						await fileFs.delete();
					}
				} catch (_) {}
				throw error;
			}
		},
	);

	runner.test("FTP: createDirectory, lsDir, delete directory", async (test) => {
		if (!testDir) throw new SkipTest("No FTP_TEST_URL");

		const fs = fsOperation(testDir);
		const dirname = `__ftp_dir_test_${Date.now()}__`;
		const dirUrl = Url.join(testDir, dirname);

		try {
			// 1. Create directory
			const createdDirUrl = await fs.createDirectory(dirname);
			test.assertEqual(
				createdDirUrl,
				dirUrl,
				"Created directory URL should match",
			);

			const dirFs = fsOperation(createdDirUrl);
			const exists = await dirFs.exists();
			test.assertEqual(exists, true, "Created directory should exist");

			// 2. Stat check
			const stat = await dirFs.stat();
			test.assertEqual(
				stat.isDirectory,
				true,
				"Stat should show isDirectory true",
			);
			test.assertEqual(stat.isFile, false, "Stat should show isFile false");

			// 3. Create a file inside directory
			const fileUrl = await dirFs.createFile("child.txt", "child content");

			// 4. List directory contents
			const list = await dirFs.lsDir();
			const child = list.find((item) => item.name === "child.txt");
			test.assert(
				child !== undefined,
				"lsDir should list the created child file",
			);
			test.assertEqual(child.isFile, true, "child item should be a file");

			// 5. Delete child file and directory
			const childFs = fsOperation(fileUrl);
			await childFs.delete();
			await dirFs.delete();

			const dirExistsAfterDelete = await dirFs.exists();
			test.assertEqual(
				dirExistsAfterDelete,
				false,
				"Directory should not exist after deletion",
			);
		} catch (error) {
			try {
				const dirFs = fsOperation(dirUrl);
				if (await dirFs.exists()) {
					await dirFs.delete();
				}
			} catch (_) {}
			throw error;
		}
	});

	return await runner.run(writeOutput);
}
