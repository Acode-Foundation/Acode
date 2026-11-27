import bridge from "./bridge";

interface BuildInformation {
	baseUrl: string | null;
	packageName: string;
	basePackageName: string;
	displayName: string;
	name: string;
	version: string;
	versionCode: number;
	debug: boolean;
	installDate: Date | null;
	buildType: string;
	flavor: string;
}
const info: BuildInformation = {
	baseUrl: null,
	packageName: "",
	basePackageName: "",
	displayName: "",
	name: "",
	version: "",
	versionCode: 0,
	debug: false,
	installDate: null,
	buildType: "",
	flavor: "",
};
export default info;
export async function initializeBuildInfo() {
	const result = await bridge("BuildInfo")<
		Partial<Omit<BuildInformation, "installDate">> & {
			installDate?: string | number;
		}
	>("init");
	if (!result) return;
	Object.assign(info, result);
	if (result.installDate) info.installDate = new Date(result.installDate);
	const script = [...document.scripts].find((script) =>
		script.src.split("?")[0].endsWith("/build/native.js"),
	);
	info.baseUrl = script
		? script.src.split("?")[0].slice(0, -"build/native.js".length)
		: null;
}
