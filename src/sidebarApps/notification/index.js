import NotificationManager from "lib/notificationManager";
import "./style.scss";
import Sidebar from "components/sidebar";

/**@type {HTMLElement} */
let container;
/** @type {HTMLElement} */
let $notificationContainer = null;

let notificationManager;

export default [
	"notifications", // icon
	"notification", // id
	strings.notifications, // title
	initApp, // init function
	false, // prepend
	onSelected, // onSelected function
];

const $header = (
	<div className="header">
		<div className="title">
			{strings.notifications}
			<span
				className="clear-all icon delete_outline"
				onclick={() => notificationManager.clearAll()}
			/>
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
	$notificationContainer = <div className="notifications-container scroll" />;
	container.append($notificationContainer);

	notificationManager = new NotificationManager();

	Sidebar.on("show", onSelected);
}

/**
 * On selected handler for files app
 * @param {HTMLElement} el
 */
function onSelected(el) {
	const $scrollableLists = container.getAll(":scope .scroll[data-scroll-top]");
	for (const $el of $scrollableLists) {
		$el.scrollTop = $el.dataset.scrollTop;
	}
}
