export default function haptic(duration) {
	try {
		if (globalThis.Bridge?.platformId === "ios") {
			globalThis.Bridge.exec(null, null, "Native", "haptic", []);
		} else {
			globalThis.navigator?.vibrate?.(duration);
		}
	} catch (error) {
		console.error("Haptic feedback failed", error);
	}
}
