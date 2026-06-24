import { TestRunner } from "./tester";
import JSZip from "jszip";

export async function runJsZipTests(writeOutput) {
	const runner = new TestRunner("JSZip-Java Compatibility Tests");

	const helperCompareBuffers = (buf1, buf2) => {
		const arr1 = new Uint8Array(buf1);
		const arr2 = new Uint8Array(buf2);
		if (arr1.length !== arr2.length) return false;
		for (let i = 0; i < arr1.length; i++) {
			if (arr1[i] !== arr2[i]) return false;
		}
		return true;
	};

	// Test 1: Constructor and instance check
	runner.test("Instance Creation", (test) => {
		const stdZip = new JSZip();
		const jvZip = new window.JSZip();

		test.assert(stdZip instanceof JSZip, "stdZip should be instance of JSZip");
		test.assert(jvZip instanceof window.JSZip, "jvZip should be instance of window.JSZip");
		test.assertEqual(typeof jvZip.file, "function", "jvZip.file should be a function");
		test.assertEqual(typeof jvZip.folder, "function", "jvZip.folder should be a function");
	});

	// Test 2: API Function Presence & Equivalence
	runner.test("API Function Presence", (test) => {
		const stdZip = new JSZip();
		const jvZip = new window.JSZip();

		// Static methods on JSZip constructor
		const stdStaticKeys = Object.keys(JSZip);
		for (const key of stdStaticKeys) {
			if (typeof JSZip[key] === "function") {
				test.assertEqual(typeof window.JSZip[key], "function", `Static function '${key}' must be present on window.JSZip`);
			}
		}

		// Instance methods / prototype methods
		const stdProto = Object.getPrototypeOf(stdZip);
		const stdProtoKeys = Object.getOwnPropertyNames(stdProto);
		
		for (const key of stdProtoKeys) {
			if (key === "constructor") continue;
			// Filter internal/private methods (methods starting with _)
			if (key.startsWith("_")) continue;
			if (typeof stdProto[key] === "function") {
				test.assertEqual(typeof Object.getPrototypeOf(jvZip)[key], "function", `Instance prototype function '${key}' must be present on window.JSZip`);
			}
		}

		// JSZipObject prototype methods
		const stdFile = stdZip.file("dummy.txt", "content").file("dummy.txt");
		const jvFile = jvZip.file("dummy.txt", "content").file("dummy.txt");
		
		const stdFileProto = Object.getPrototypeOf(stdFile);
		const stdFileProtoKeys = Object.getOwnPropertyNames(stdFileProto);
		
		for (const key of stdFileProtoKeys) {
			if (key === "constructor") continue;
			if (key.startsWith("_")) continue;
			if (typeof stdFileProto[key] === "function") {
				test.assertEqual(typeof Object.getPrototypeOf(jvFile)[key], "function", `JSZipObject prototype function '${key}' must be present on JSZipObject`);
			}
		}
	});

	// Test 3: Adding and reading text file content
	runner.test("File Add & Async Read (Text)", async (test) => {
		const stdZip = new JSZip();
		const jvZip = new window.JSZip();

		const content = "Hello JSZip World!";
		stdZip.file("test.txt", content);
		jvZip.file("test.txt", content);

		const stdRes = await stdZip.file("test.txt").async("text");
		const jvRes = await jvZip.file("test.txt").async("text");

		test.assertEqual(jvRes, stdRes, "Returned text content must match standard JSZip");
		test.assertEqual(jvRes, content, "Returned content must match original content");
	});

	// Test 4: Adding and reading binary/arraybuffer file content
	runner.test("File Add & Async Read (Binary ArrayBuffer)", async (test) => {
		const stdZip = new JSZip();
		const jvZip = new window.JSZip();

		const bytes = new Uint8Array([72, 101, 108, 108, 111, 0, 1, 2, 3]);
		const buffer = bytes.buffer;

		stdZip.file("bin.dat", buffer);
		jvZip.file("bin.dat", buffer);

		const stdBuf = await stdZip.file("bin.dat").async("arraybuffer");
		const jvBuf = await jvZip.file("bin.dat").async("arraybuffer");

		test.assert(helperCompareBuffers(jvBuf, stdBuf), "Returned ArrayBuffer should match standard JSZip");
		
		const stdArr = await stdZip.file("bin.dat").async("uint8array");
		const jvArr = await jvZip.file("bin.dat").async("uint8array");
		
		test.assertEqual(jvArr.length, stdArr.length, "Uint8Array lengths must match");
		test.assertEqual(jvArr[5], 0, "Binary zero must be preserved");
		test.assertEqual(jvArr[8], 3, "Binary values must match");
	});

	// Test 5: folder prefixing and nested hierarchy
	runner.test("Folder Navigation & Structure", async (test) => {
		const stdZip = new JSZip();
		const jvZip = new window.JSZip();

		const stdSub = stdZip.folder("nested").folder("deep");
		const jvSub = jvZip.folder("nested").folder("deep");

		stdSub.file("hello.txt", "inside nested");
		jvSub.file("hello.txt", "inside nested");

		// Access via root
		const stdRes = await stdZip.file("nested/deep/hello.txt").async("text");
		const jvRes = await jvZip.file("nested/deep/hello.txt").async("text");

		test.assertEqual(jvRes, stdRes, "Nested file content should match via root access");
		
		// Access via child instance
		const stdResChild = await stdSub.file("hello.txt").async("text");
		const jvResChild = await jvSub.file("hello.txt").async("text");

		test.assertEqual(jvResChild, stdResChild, "Nested file content should match via child access");
	});

	// Test 6: Files directory listing and iteration comparison
	runner.test("Directory listing & forEach comparison", (test) => {
		const stdZip = new JSZip();
		const jvZip = new window.JSZip();

		const setup = (zip) => {
			zip.file("a.txt", "1");
			zip.file("b/c.txt", "2");
			zip.folder("b/d");
		};

		setup(stdZip);
		setup(jvZip);

		const stdList = [];
		stdZip.forEach((rel, obj) => {
			stdList.push({ path: rel, isDir: obj.dir });
		});

		const jvList = [];
		jvZip.forEach((rel, obj) => {
			jvList.push({ path: rel, isDir: obj.dir });
		});

		test.assertEqual(jvList.length, stdList.length, "forEach count must match standard JSZip");
		
		stdList.sort((a, b) => a.path.localeCompare(b.path));
		jvList.sort((a, b) => a.path.localeCompare(b.path));

		for (let i = 0; i < stdList.length; i++) {
			test.assertEqual(jvList[i].path, stdList[i].path, `Entry ${i} path must match`);
			test.assertEqual(jvList[i].isDir, stdList[i].isDir, `Entry ${i} isDir must match`);
		}
	});

	// Test 7: Removing files and directories
	runner.test("File & Folder Removal", async (test) => {
		const stdZip = new JSZip();
		const jvZip = new window.JSZip();

		stdZip.file("test1.txt", "data");
		stdZip.file("folder/test2.txt", "data");
		stdZip.remove("test1.txt");
		stdZip.remove("folder");

		jvZip.file("test1.txt", "data");
		jvZip.file("folder/test2.txt", "data");
		jvZip.remove("test1.txt");
		jvZip.remove("folder");

		test.assertEqual(jvZip.file("test1.txt"), null, "test1.txt must be null after removal");
		test.assertEqual(jvZip.file("folder/test2.txt"), null, "folder/test2.txt must be null after folder removal");

		const stdKeys = Object.keys(stdZip.files);
		const jvKeys = Object.keys(jvZip.files);
		test.assertEqual(jvKeys.length, stdKeys.length, "Remaining file keys count must match standard JSZip");
	});

	// Test 8: Output Type conversion compatibility (Base64, BinaryString)
	runner.test("Type Conversions (base64, binarystring)", async (test) => {
		const jvZip = new window.JSZip();
		const content = "Testing type conversions \x00\x01\x02";
		jvZip.file("data.txt", content, { binary: true });

		const b64 = await jvZip.file("data.txt").async("base64");
		const binStr = await jvZip.file("data.txt").async("binarystring");
		const text = await jvZip.file("data.txt").async("text");

		test.assertEqual(b64, window.btoa(content), "Base64 conversion should match window.btoa");
		test.assertEqual(binStr, content, "BinaryString must match original raw string");
		test.assert(text.startsWith("Testing type conversions"), "Text must resolve correctly");
	});

	// Test 9: ZIP Compilation and Cross-Load compatibility
	runner.test("ZIP Generation & Cross-Loading", async (test) => {
		const stdZip = new JSZip();
		stdZip.file("info.json", JSON.stringify({ version: "1.0.0" }));
		stdZip.file("images/logo.png", new Uint8Array([1, 2, 3, 4]).buffer);

		// 1. Generate using standard, load in jszip-java
		const stdZipBuffer = await stdZip.generateAsync({ type: "arraybuffer" });
		
		const jvZip = new window.JSZip();
		await jvZip.loadAsync(stdZipBuffer);

		const jvJson = await jvZip.file("info.json").async("text");
		const jvPng = await jvZip.file("images/logo.png").async("uint8array");

		test.assertEqual(JSON.parse(jvJson).version, "1.0.0", "Loaded JSON config should match");
		test.assertEqual(jvPng.length, 4, "Loaded nested binary length must match");
		test.assertEqual(jvPng[3], 4, "Loaded binary byte must match");

		// 2. Generate using jszip-java, load in standard
		const jvZipBuffer = await jvZip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });

		const crossStdZip = new JSZip();
		await crossStdZip.loadAsync(jvZipBuffer);

		const crossJson = await crossStdZip.file("info.json").async("text");
		test.assertEqual(JSON.parse(crossJson).version, "1.0.0", "Cross-loaded standard JSZip must read jszip-java output successfully");
	});

	// Run tests
	return await runner.run(writeOutput);
}
