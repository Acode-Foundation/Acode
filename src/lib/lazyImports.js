export async function loadFileBrowser() {
	return (
		await import(/* webpackChunkName: "fileBrowser" */ "pages/fileBrowser")
	).default;
}
