export const INSTALL_SOURCE_PLAY = "com.android.vending";

export function isPlayStoreInstall() {
	return window.appInstallSource === INSTALL_SOURCE_PLAY;
}
