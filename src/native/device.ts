import bridge from "./bridge";

const call = bridge("Device");
const device = {
	available: false,
	platform: null,
	version: null,
	uuid: null,
	runtimeVersion: "1.0.0",
	model: null,
	manufacturer: null,
	isVirtual: null,
	serial: null,
	getInfo(success: (info: Device) => void, failure?: (error: unknown) => void) {
		call<Device>("getDeviceInfo").then(success, failure);
	},
};
export default device;
export async function initializeDevice() {
	const info = await call<Device>("getDeviceInfo");
	Object.assign(device, info, {
		available: true,
		runtimeVersion: "1.0.0",
		manufacturer: info.manufacturer || "unknown",
		serial: info.serial || "unknown",
	});
}
