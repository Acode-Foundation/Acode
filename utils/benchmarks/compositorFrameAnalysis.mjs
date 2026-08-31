import jpeg from "jpeg-js";

export function parseCompositorColor(value) {
	const match = /rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?\s*\)/.exec(
		value || "",
	);
	if (!match || (match[4] != null && Number(match[4]) === 0)) return null;
	return match.slice(1, 4).map(Number);
}

export function analyzeCompositorFrame(frame, setup) {
	const decoded = jpeg.decode(Buffer.from(frame.data, "base64"), {
		useTArray: true,
		formatAsRGBA: true,
	});
	const scaleX = decoded.width / setup.viewportWidth;
	const scaleY = decoded.height / setup.viewportHeight;
	const rect = setup.contentRect;
	const left = Math.max(0, Math.floor((rect.left + 4) * scaleX));
	const right = Math.min(
		decoded.width,
		Math.ceil((rect.left + rect.width * 0.85) * scaleX),
	);
	const top = Math.max(0, Math.floor((rect.top + 6) * scaleY));
	const bottom = Math.min(
		decoded.height,
		Math.ceil((rect.top + rect.height - 6) * scaleY),
	);
	const background = setup.backgrounds
		.map(parseCompositorColor)
		.find(Boolean);
	if (!background || right <= left || bottom <= top) {
		return { blank: false, nonBackgroundRatio: null };
	}

	let sampled = 0;
	let nonBackground = 0;
	for (let y = top; y < bottom; y += 2) {
		for (let x = left; x < right; x += 2) {
			const offset = (y * decoded.width + x) * 4;
			const distance = Math.max(
				Math.abs(decoded.data[offset] - background[0]),
				Math.abs(decoded.data[offset + 1] - background[1]),
				Math.abs(decoded.data[offset + 2] - background[2]),
			);
			if (distance > 24) nonBackground++;
			sampled++;
		}
	}
	const nonBackgroundRatio = sampled ? nonBackground / sampled : 0;
	return { blank: nonBackgroundRatio < 0.003, nonBackgroundRatio };
}
