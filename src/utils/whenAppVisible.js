/**
 * Resolves once the startup splash is gone, so optional code loads after the
 * editor is visible instead of competing with startup.
 * @returns {Promise<void>}
 */
export default function whenAppVisible() {
	if (!document.body.classList.contains("loading")) return Promise.resolve();
	return new Promise((resolve) => {
		const observer = new MutationObserver(() => {
			if (document.body.classList.contains("loading")) return;
			observer.disconnect();
			resolve();
		});
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});
	});
}
