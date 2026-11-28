import multiPrompt from "dialogs/multiPrompt";
import platform from "lib/platform";
import helpers from "utils/helpers";

export default async function sponsorDetails(
	productId,
	title = productId,
	recovering = false,
) {
	let image;
	let result;
	let pendingImage;
	const pickerController = new AbortController();
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
			readOnly: true,
			onclick() {
				if (!pendingImage) {
					pendingImage = selectImage(this).finally(() => {
						pendingImage = null;
					});
				}
			},
		});
	}

	// multiPrompt rejects when the dialog is cancelled.
	result = await multiPrompt(
		title === productId
			? productId[0].toUpperCase() + productId.slice(1)
			: title,
		[
			{
				placeholder: "Name *",
				required: true,
				id: "name",
			},
			{
				placeholder: "Email",
				required: false,
				id: "email",
				type: "email",
				match:
					/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+?"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
			},
			...extraFields,
			{
				placeholder: "Show in sponsors list",
				required: false,
				id: "public",
				type: "checkbox",
				value: true,
			},
		],
		recovering
			? "Your purchase is already paid. Add your sponsor details to finish registration; you will not be charged again."
			: undefined,
	).catch(() => null);

	// Some WebViews never emit cancel. Closing the form ends any unselected picker,
	// but a selected file must still finish reading before we save the profile.
	pickerController.abort();
	if (!result) {
		return;
	}

	await pendingImage;
	if (image) {
		result.image = image;
	}

	localStorage.setItem(`sponsor_${productId}`, JSON.stringify(result));
	return result;

	async function selectImage(field) {
		try {
			const file = await pickImage(pickerController.signal);
			if (!file) return;
			if (file.size > 500000) {
				field.setError("File size exceeds 500KB");
				return;
			}
			const dataUrl = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result);
				reader.onerror = () => reject(reader.error);
				reader.onabort = () => reject(new Error("Image read cancelled"));
				reader.readAsDataURL(file);
			});
			image = dataUrl;
			field.value = file.name;
			field.setError("");
		} catch (error) {
			helpers.error(error);
		}
	}
}

function pickImage(signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return resolve(null);
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.style.cssText =
			"position:fixed;left:-10000px;width:1px;height:1px;opacity:0;pointer-events:none";
		// Android's chooser adds the camera only with capture; iOS offers all sources without it.
		if (!platform.isIOS) input.setAttribute("capture", "environment");
		const cancel = () => finish(null);
		input.onchange = () => finish(input.files?.[0] || null);
		input.oncancel = cancel;
		signal.addEventListener("abort", cancel, { once: true });
		document.body.append(input);
		try {
			input.click();
		} catch (error) {
			cleanup();
			reject(error);
		}

		function finish(file) {
			cleanup();
			resolve(file);
		}

		function cleanup() {
			signal.removeEventListener("abort", cancel);
			input.onchange = null;
			input.oncancel = null;
			input.remove();
		}
	});
}
