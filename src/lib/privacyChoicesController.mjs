export const PRIVACY_CHOICES_KEY = "privacyChoices";

/**
 * Keeps the Privacy Choices setting synchronized with the latest UMP state.
 *
 * @param {{
 *   page: {
 *     setItemVisibility:(key:string, visible:boolean)=>boolean,
 *     onClose:(callback:()=>void)=>()=>void
 *   },
 *   subscribe:(listener:(state:{privacyOptionsRequired:boolean})=>void)=>()=>void,
 *   key?:string
 * }} options
 */
export function bindPrivacyChoices({
	page,
	subscribe,
	key = PRIVACY_CHOICES_KEY,
}) {
	let active = true;
	let unsubscribeState = () => {};
	let unsubscribeClose = () => {};

	const dispose = () => {
		if (!active) return;
		active = false;
		unsubscribeState();
		unsubscribeClose();
	};

	unsubscribeState = subscribe((state) => {
		if (!active) return;
		page.setItemVisibility(key, state?.privacyOptionsRequired === true);
	});
	unsubscribeClose = page.onClose(dispose);

	return dispose;
}
