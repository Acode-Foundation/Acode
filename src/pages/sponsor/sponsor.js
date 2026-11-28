import "./style.scss";
import Logo from "components/logo";
import Page from "components/page";
import loader from "dialogs/loader";
import actionStack from "lib/actionStack";
import config from "lib/config";
import helpers from "utils/helpers";
import sponsorDetails from "./details";
import startSponsorRecovery, {
	recoverSponsorPurchases,
	subscribeSponsorPurchases,
} from "./recovery";

/**
 * Sponsor page
 * @param {() => void} onclose
 */
export default function Sponsor(onclose) {
	if (!helpers.isIapAvailable()) {
		helpers.error(strings["product not available"]);
		return;
	}
	const $page = Page(strings.sponsor);
	let cancel = false;
	let selecting = false;
	let ownsLoader = false;
	const unsubscribe = subscribeSponsorPurchases((event) => {
		if (cancel) return;
		hideLoader();
		if (event === "success") $page.hide();
	});

	actionStack.push({
		id: "sponsor_page",
		action: $page.hide,
	});

	$page.onhide = function () {
		unsubscribe();
		hideLoader();
		cancel = true;
		onclose?.();
		actionStack.remove("sponsor_page");
	};

	app.append($page);

	showLoader();
	void startSponsorRecovery(true).catch(onPurchaseError);

	render()
		.catch((error) => {
			if (cancel) return;
			actionStack.pop();
			helpers.error(error);
		})
		.finally(hideLoader);

	async function render() {
		let products = await new Promise((resolve, reject) => {
			iap.getProducts(
				config.SKU_LIST,
				(products) => {
					resolve(products);
				},
				(err) => {
					reject(err);
				},
			);
		});

		if (cancel) return;
		if (!products.length) throw new Error(strings["product not available"]);

		products = products.sort((a, b) => {
			const aPrice = Number.parseFloat(a.price.replace(/[^0-9.]/g, ""));
			const bPrice = Number.parseFloat(b.price.replace(/[^0-9.]/g, ""));
			return (b.priceAmountMicros ?? bPrice) - (a.priceAmountMicros ?? aPrice);
		});

		$page.body = (
			<div id="sponsor-page" className="main">
				<div className="header">
					<Logo />
					<h1>Sponsor Acode</h1>
					<p className="subtitle">Support the future of mobile coding</p>
				</div>
				<div className="tiers">
					{products.map((product) => (
						<div className={`tier ${product.productId}`}>
							<div className="tier-header">
								<div className="tier-name">
									<span className={`tier-icon ${product.productId}`}></span>
									{onlyTitle(product.title)}
								</div>
								<div className="tier-price">{product.price} / 30 days</div>
							</div>
							<div
								className="tier-description"
								innerText={product.description}
							></div>
							<button
								className="purchase-btn"
								onclick={() => handlePurchase(product.productId, product.title)}
							>
								{strings.select}
							</button>
						</div>
					))}
				</div>
			</div>
		);
	}

	async function handlePurchase(productId, title) {
		if (cancel || selecting) return;
		selecting = true;
		try {
			showLoader();
			const recovered = await recoverSponsorPurchases(true);
			if (cancel) return;
			hideLoader();
			if (!recovered)
				throw new Error(
					"Unable to check existing purchases. Please try again.",
				);
			if (recovered.has(productId))
				throw new Error(
					"An earlier purchase for this tier was found. No new charge was started.",
				);
			const details = await sponsorDetails(productId, onlyTitle(title));
			if (cancel || !details) return;
			showLoader();
			iap.purchase(productId, undefined, onPurchaseError, onPurchaseError);
		} catch (error) {
			onPurchaseError(error);
		} finally {
			selecting = false;
		}
	}

	function onPurchaseError(error) {
		if (cancel) return;
		if (error !== iap.USER_CANCELED) helpers.error(error);
		hideLoader();
	}

	function showLoader() {
		if (cancel) return;
		ownsLoader = true;
		loader.showTitleLoader();
	}

	function hideLoader() {
		if (cancel || !ownsLoader) return;
		ownsLoader = false;
		loader.removeTitleLoader();
	}
}

function onlyTitle(title) {
	return title.replace(" (Acode - code editor | FOSS)", "");
}
