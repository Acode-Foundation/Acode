import { APP_ICONS } from "lib/appIcons";
import openAppIconDialog from "./appIconSetting";

const previews = new Map();

export default function appIconSetting(...args) {
	preloadAppIconSetting();
	return openAppIconDialog(...args);
}

export function preloadAppIconSetting() {
	return Promise.allSettled(
		APP_ICONS.map(({ image }) => preloadPreview(image)),
	);
}

function preloadPreview(src) {
	if (previews.has(src)) return previews.get(src);
	const image = new Image();
	const ready = new Promise((resolve, reject) => {
		image.onload = resolve;
		image.onerror = reject;
		image.src = src;
	})
		.then(async () => {
			// A decoded preview is preferable, but a loaded image is still usable.
			if (typeof image.decode === "function")
				await image.decode().catch(() => {});
			return image;
		})
		.catch((error) => {
			previews.delete(src);
			throw error;
		})
		.finally(() => {
			image.onload = null;
			image.onerror = null;
		});
	previews.set(src, ready);
	return ready;
}
