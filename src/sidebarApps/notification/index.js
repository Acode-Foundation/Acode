import "./style.scss";
import Sidebar from "components/sidebar";
import notificationManager from "lib/notificationManager";

/**@type {HTMLElement} */
let container;
/** @type {HTMLElement} */
let $notificationContainer = null;

export default [
	"notifications", // icon
	"notification", // id
	strings["notifications"], // title
	initApp, // init function
	false, // prepend
	onSelected, // onSelected function
];

const $header = (
	<div className="header">
		<div className="title">
			{strings["notifications"]}
			<button
				type="button"
				className="icon-button"
				title={strings["clear all"]}
				aria-label={strings["clear all"]}
				onclick={() => notificationManager.clearAll()}
			>
				<span data-action="clear" className="icon delete_outline"></span>
			</button>
		</div>
	</div>
);

/**
 * Initialize files app
 * @param {HTMLElement} el
 */
function initApp(el) {
	container = el;
	container.classList.add("notifications");
	container.content = $header;
	$notificationContainer = (
		<div className="notifications-container scroll"></div>
	);
	container.append($notificationContainer);

	Sidebar.on("show", onSelected);
}

/**
 * On selected handler for files app
 * @param {HTMLElement} el
 */
function onSelected(el) {
	// Sidebar "show" fires for every app; only mark read when this one is open
	if (container.isConnected) notificationManager.markAllRead();
	const $scrollableLists = container.getAll(":scope .scroll[data-scroll-top]");
	$scrollableLists.forEach(($el) => {
		$el.scrollTop = $el.dataset.scrollTop;
	});
}
