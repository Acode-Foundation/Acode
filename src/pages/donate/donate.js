import "./donate.scss";
import ajax from "@deadlyjack/ajax";
import Page from "components/page";
import alert from "dialogs/alert";
import box from "dialogs/box";
import loader from "dialogs/loader";
import actionStack from "lib/actionStack";
import constants from "lib/constants";
import mustache from "mustache";
import helpers from "utils/helpers";
import bodyHBS from "./donate.hbs";
import productHBS from "./product.hbs";

//TODO: fix (-1 means, user is not logged in to any google account)

export default function DonateInclude() {
	const BASE_URL = "https://acode.app/res/";
	const $page = Page(strings.support);
	let adShown = false;

	actionStack.push({
		id: "donate page",
		action: $page.hide,
	});

	$page.onhide = function () {
		actionStack.remove("donate page");
		if (adShown) helpers.hideAd();
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
						msg += strings["donation message"];
					}

					box(strings.info.toUpperCase(), msg);
				})();
			}
		},
		(err) => {
			if (err !== iap.USER_CANCELED) {
				alert(strings.error.toUpperCase(), err);
			}
		},
	);

	app.onclick = function (e) {
		const $target = e.target;
		if (!($target instanceof HTMLElement)) return;
		const action = $target.getAttribute("action");
		let value;

		switch (action) {
			case "donate":
				value = $target.getAttribute("value");
				iap.purchase(
					value,
					() => {
						// ignore
					},
					(err) => {
						if (err !== iap.USER_CANCELED) {
							alert(strings.error, err);
						}
					},
				);
				break;
			default:
				break;
		}
	};

	loader.showTitleLoader();

	(async function render() {
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

		products = products.sort((a, b) => {
			const aPrice = Number.parseFloat(a.price.replace(/[^0-9.]/g, ""));
			const bPrice = Number.parseFloat(b.price.replace(/[^0-9.]/g, ""));
			return aPrice - bPrice;
		});

		products = products.map((product) => {
			product.image = `${BASE_URL}${product.productId === "bronze" ? "1.jpeg" : "2.jpeg"}`;
			product.isCoffee = product.productId === "bronze" ? true : false;
			product.donate = strings.donate.replace("{amount}", product.price);
			if (product.description && product.description.includes("-")) {
				[product.description, product.author] = product.description
					.split("-")
					.map((s) => s.trim());
			}
			return product;
		});

		const col1 = [];
		products.forEach((product, i) => {
			const html = mustache.render(productHBS, product);
			col1.push(html);
		});

		$page.body = helpers.parseHTML(
			mustache.render(bodyHBS, {
				card: col1.join(""),
			}),
		);
		helpers.showAd();
		adShown = true;
	})()
		.catch((error) => {
			actionStack.pop();
			helpers.error(error);
		})
		.finally(() => {
			loader.removeTitleLoader();
		});
}
