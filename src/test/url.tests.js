import Url from "../utils/Url";
import { TestRunner } from "./tester";

const JOIN_CASES = [
	{
		name: "Android SAF join",
		folderUrl:
			"content://com.android.externalstorage.documents/tree/primary%3ATesthtml",
		activeLocation:
			"content://com.android.externalstorage.documents/tree/primary%3ATesthtml::primary:Testhtml/Styles/",
		expectedJoined:
			"content://com.android.externalstorage.documents/tree/primary%3ATesthtml::primary:Testhtml/Styles/index.html",
	},
	{
		name: "Termux SAF join",
		folderUrl:
			"content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome%2Facode-site-ui",
		activeLocation:
			"content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome%2Facode-site-ui::/data/data/com.termux/files/home/acode-site-ui/",
		expectedJoined:
			"content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome%2Facode-site-ui::/data/data/com.termux/files/home/acode-site-ui/index.html",
	},
	{
		name: "Acode SAF join",
		folderUrl:
			"content://com.foxdebug.acode.documents/tree/%2Fdata%2Fuser%2F0%2Fcom.foxdebug.acode%2Ffiles%2Fpublic",
		activeLocation:
			"content://com.foxdebug.acode.documents/tree/%2Fdata%2Fuser%2F0%2Fcom.foxdebug.acode%2Ffiles%2Fpublic::/data/user/0/com.foxdebug.acode/files/public/",
		expectedJoined:
			"content://com.foxdebug.acode.documents/tree/%2Fdata%2Fuser%2F0%2Fcom.foxdebug.acode%2Ffiles%2Fpublic::/data/user/0/com.foxdebug.acode/files/public/index.html",
	},
];

const TRAILING_SLASH_CASES = [
	{
		name: "Android SAF trailing slash",
		a: "content://com.android.externalstorage.documents/tree/primary%3ATesthtml/",
		b: "content://com.android.externalstorage.documents/tree/primary%3ATesthtml",
	},
	{
		name: "Termux SAF trailing slash",
		a: "content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome%2Facode-site-ui/",
		b: "content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome%2Facode-site-ui",
	},
	{
		name: "Acode SAF trailing slash",
		a: "content://com.foxdebug.acode.documents/tree/%2Fdata%2Fuser%2F0%2Fcom.foxdebug.acode%2Ffiles%2Fpublic/",
		b: "content://com.foxdebug.acode.documents/tree/%2Fdata%2Fuser%2F0%2Fcom.foxdebug.acode%2Ffiles%2Fpublic",
	},
];

function assertJoinCase(
	test,
	{ folderUrl, activeLocation, expectedJoined, segment },
) {
	const joined = Url.join(activeLocation, segment || "index.html");

	test.assert(joined !== null, "Joining the SAF URL should return a value");
	test.assertEqual(
		joined,
		expectedJoined,
		"Joined URL should match the expected SAF file URI",
	);
	test.assert(
		!Url.areSame(folderUrl, joined),
		"Folder URL and joined file URL should not be considered the same",
	);
}

export async function runUrlTests(writeOutput) {
	const runner = new TestRunner("URL / SAF URIs");

	for (const joinCase of JOIN_CASES) {
		runner.test(joinCase.name, (test) => {
			assertJoinCase(test, joinCase);
		});
	}

	for (const trailingSlashCase of TRAILING_SLASH_CASES) {
		runner.test(trailingSlashCase.name, (test) => {
			test.assert(
				Url.areSame(trailingSlashCase.a, trailingSlashCase.b),
				"Folder URLs differing only by a trailing slash should be same",
			);
		});
	}

	runner.test("Android SAF leading slash", (test) => {
		assertJoinCase(test, {
			...JOIN_CASES[0],
			segment: "/index.html",
		});
	});

	return await runner.run(writeOutput);
}
