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
				onclick={() => notificationManager.clearAll()}
			>
				<span data-action="clear" className="icon clearclose"></span>
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

	notificationManager = new NotificationManager();

	Sidebar.on("show", onSelected);
}

/**
 * On selected handler for files app
 * @param {HTMLElement} el
 */
function onSelected(el) {
	const $scrollableLists = container.getAll(":scope .scroll[data-scroll-top]");
	$scrollableLists.forEach(($el) => {
		$el.scrollTop = $el.dataset.scrollTop;
	});
}
