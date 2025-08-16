import "./style.scss";
import Page from "components/page";
import items, { description } from "components/quickTools/items";
import WCPage from "components/WebComponents/wcPage";
import select from "dialogs/select";
import actionStack from "lib/actionStack";
import settings from "lib/settings";
import helpers from "utils/helpers";

export default function QuickTools() {
	const $page = Page(strings["shortcut buttons"]);
	render($page);
	$page.addEventListener("click", clickHandler);

	actionStack.push({
		id: "quicktools-settings",
		action: $page.hide,
	});

	$page.onhide = () => {
		actionStack.remove("quicktools-settings");
		helpers.hideAd();
	};

	app.append($page);
	helpers.showAd();
}

/**
 * Render the page
 * @param {WCPage} $page
 */
function render($page) {
	$page.body = (
		<div className="main" id="quicktools-settings">
			{(() => {
				const totalRows = settings.QUICKTOOLS_ROWS * settings.QUICKTOOLS_GROUPS;
				const limit = settings.QUICKTOOLS_GROUP_CAPACITY;
				const rows = [];
				for (let i = 0; i < totalRows; i++) {
					const row = [];
					for (let j = 0; j < limit; j++) {
						const count = i * limit + j;
						const index = settings.value.quicktoolsItems[count];
						row.push(<Item {...items[index]} index={count} />);
					}
					rows.push(<div className="row buttons-container section">{row}</div>);
				}

				return rows;
			})()}
		</div>
	);
}

/**
 * Create a quicktools settings item
 * @param {object} param0
 * @param {string} param0.icon
 * @param {string} param0.letters
 * @param {number} param0.index
 * @returns
 */
function Item({ icon, letters, index }) {
	return (
		<span
			data-index={index}
			className={`icon ${icon}`}
			data-letters={letters}
		></span>
	);
}

/**
 * Click handler for page
 * @param {MouseEvent} e
 */
async function clickHandler(e) {
	const index = Number.parseInt(e.target.dataset.index, 10);

	if (isNaN(index)) return;

	const options = items.map(({ id, icon, letters }, i) => {
		return [i, description(id), icon, true, letters];
	});

	const i = await select(strings.select, options);
	settings.value.quicktoolsItems[index] = i;
	settings.update();
	render(this);
}
