import "./style.scss";
import Ref from "html-tag-js/ref";
import settings from "lib/settings";
import {
	$footer,
	$input,
	$toggler,
	Row,
	SearchRow1,
	SearchRow2,
} from "./footer";

/**@type {HTMLElement} */
let $row1;
/**@type {HTMLElement} */
let $row2;
/**@type {HTMLElement} */
let $searchRow1;
/**@type {HTMLElement} */
let $searchRow2;

const $searchInput = Ref();
const $replaceInput = Ref();
const $searchPos = Ref();
const $searchTotal = Ref();

export default {
	get $footer() {
		return $footer;
	},
	get $row1() {
		if ($row1) return $row1;
		$row1 = <Row row={1} />;

		settings.on("update:quicktoolsItems:after", () => {
			$row1 = <Row row={1} />;
		});

		return $row1;
	},
	get $row2() {
		if ($row2) return $row2;
		$row2 = <Row row={2} />;

		settings.on("update:quicktoolsItems:after", () => {
			$row2 = <Row row={2} />;
		});

		return $row2;
	},
	get $searchRow1() {
		if ($searchRow1) return $searchRow1;
		$searchRow1 = <SearchRow1 inputRef={$searchInput} />;
		return $searchRow1;
	},
	get $searchRow2() {
		if ($searchRow2) return $searchRow2;
		$searchRow2 = (
			<SearchRow2
				inputRef={$replaceInput}
				posRef={$searchPos}
				totalRef={$searchTotal}
			/>
		);
		return $searchRow2;
	},
	get $input() {
		return $input;
	},
	get $toggler() {
		return $toggler;
	},
	get $searchInput() {
		return $searchInput;
	},
	get $replaceInput() {
		return $replaceInput;
	},
	get $searchPos() {
		return $searchPos;
	},
	get $searchTotal() {
		return $searchTotal;
	},
};
