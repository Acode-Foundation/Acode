import WCPage from "./WebComponents/wcPage";

/**
 *
 * @param {string} title
 * @param {object} options
 * @param {HTMLElement} [options.lead] type of page
 * @param {HTMLElement} [options.tail] type of page
 * @returns {WCPage}
 */
function Page(title, options = {}) {
	const page = <wc-page />;
	page.append = page.appendBody;
	page.initializeIfNotAlreadyInitialized();
	page.settitle(title);

	if (options.tail) {
		page.header.append(options.tail);
	}
	if (options.lead) {
		page.lead = options.lead;
	}

	return page;
}

export default Page;
