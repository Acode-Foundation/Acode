import "./style.scss";
import fsOperation from "fileSystem";
import ajax from "@deadlyjack/ajax";
import Logo from "components/logo";
import Page from "components/page";
import alert from "dialogs/alert";
import box from "dialogs/box";
import loader from "dialogs/loader";
import multiPrompt from "dialogs/multiPrompt";
import actionStack from "lib/actionStack";
import constants from "lib/constants";
import helpers from "utils/helpers";

//TODO: fix (-1 means, user is not logged in to any google account)

/**
 * Sponsor page
 * @param {() => void} onclose
 */
export default function Sponsor(onclose) {
	const BASE_URL = "https://acode.app/res/";
	const $page = Page(strings.sponsor);
	let cancel = false;

	actionStack.push({
		id: "sponsor_page",
		action: $page.hide,
	});

	$page.onhide = function () {
		onclose?.();
		cancel = true;
		actionStack.remove("sponsor_page");
	};

	app.append($page);

	iap.setPurchaseUpdatedListener(
		(purchases) => {
			if (Array.isArray(purchases)) {
				(async function () {
					const promises = [];
					for (let purchase of purchases) {
						promises.push(
							new Promise((resolve, reject) => {
								iap.consume(
									purchase.purchaseToken,
									(resCode) => {
										purchase.consumed = resCode === iap.OK ? true : false;
										purchase.consumeCode = resCode;
										resolve(purchase);
									},
									(err) => {
										reject(err);
									},
								);
							}),
						);
					}

					const settledPromises = await Promise.allSettled(promises);
					const rejectedPromise = settledPromises.find(
						(promise) => promise.status === "rejected",
					);
					let msg = "";
					if (rejectedPromise) {
						msg = "Something went wrong.\n";
						msg += `Error: ${rejectedPromise.reason}\n`;
						msg += `Code: ${rejectedPromise.value.resCode}`;
					} else {
						const blob = await ajax({
							url: BASE_URL + "6.jpeg",
							responseType: "blob",
						}).catch((err) => {
							helpers.error(err);
						});
						const url = URL.createObjectURL(blob);
						msg = `<img src="${url}" class="donate-image" />`;
						msg += "<br><p>Thank you for supporting Acode!</p>";
					}

					const order = settledPromises[0].value;
					const [productId] = order.productIds;
					const sponsorDetails = JSON.parse(
						localStorage.getItem(`sponsor_${productId}`),
					);

					try {
						const res = await ajax.post(`${constants.API_BASE}/sponsor`, {
							data: {
								...sponsorDetails,
								tier: productId,
								packageName: BuildInfo.packageName,
								purchaseToken: order.purchaseToken,
							},
						});
						if (res.error) {
							helpers.error(res.error);
						} else {
							box(strings.info.toUpperCase(), msg);
							localStorage.removeItem(`sponsor_${productId}`);
							$page.hide();
						}
					} catch (error) {
						helpers.error(error);
					} finally {
						loader.removeTitleLoader();
					}
				})();
			}
		},
		(err) => {
			if (err !== iap.USER_CANCELED) {
				alert(strings.error.toUpperCase(), err);
			}
			loader.removeTitleLoader();
		},
	);

	loader.showTitleLoader();
	render()
		.catch((error) => {
			actionStack.pop();
			helpers.error(error);
		})
		.finally(() => {
			loader.removeTitleLoader();
		});

	async function render() {
		let products = await new Promise((resolve, reject) => {
			iap.getProducts(
				constants.SKU_LIST,
				(products) => {
					resolve(products);
				},
				(err) => {
					reject(err);
				},
			);
		});

		if (cancel) return;

		products = products.sort((a, b) => {
			const aPrice = Number.parseFloat(a.price.replace(/[^0-9.]/g, ""));
			const bPrice = Number.parseFloat(b.price.replace(/[^0-9.]/g, ""));
			return bPrice - aPrice;
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
								<div className="tier-price">{product.price}/Month</div>
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
}

async function handlePurchase(productId, title) {
	let image;
	let result;
	const extraFields = [];

	if (["silver", "gold", "platinum", "titanium"].includes(productId)) {
		extraFields.push({
			placeholder: "Website",
			required: false,
			id: "website",
			type: "url",
		});
	}

	if (productId === "titanium") {
		extraFields.push({
			placeholder: "Tagline",
			required: false,
			id: "tagline",
			type: "text",
		});
	}

	if (["gold", "platinum", "titanium"].includes(productId)) {
		extraFields.push({
			placeholder: "Logo/Image (500KB max)",
			required: false,
			type: "text",
			id: "image",
			onclick() {
				sdcard.openDocumentFile(async (res) => {
					if (res.length > 500000) {
						this.setError("File size exceeds 500KB");
						return;
					}

					this.setError("");
					this.value = res.filename;
					const arraybuffer = await fsOperation(res.uri).readFile();
					const blob = new Blob([arraybuffer], { type: res.type });
					const reader = new FileReader();
					reader.onload = () => {
						image = reader.result;

						if (result && typeof result === "object") {
							result.image = image;
							localStorage.setItem(
								`sponsor_${productId}`,
								JSON.stringify(result),
							);
						}
					};
					reader.readAsDataURL(blob);
				}, "image/*");
			},
		});
	}

	result = await multiPrompt(onlyTitle(title), [
		{
			placeholder: "Name",
			required: true,
			id: "name",
		},
		{
			placeholder: "Email",
			required: false,
			id: "email",
			type: "email",
			match:
				/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
		},
		...extraFields,
		{
			placeholder: "Show in sponsors list",
			required: false,
			id: "public",
			type: "checkbox",
			value: true,
		},
	]);

	if (!result) {
		return;
	}

	if (image) {
		result.image = image;
	}

	localStorage.setItem(`sponsor_${productId}`, JSON.stringify(result));
	loader.showTitleLoader();
	iap.purchase(productId);
}

function onlyTitle(title) {
	return title.replace(" (Acode - code editor | FOSS)", "");
}
