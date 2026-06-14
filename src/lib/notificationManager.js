import sidebarApps from "sidebarApps";
import DOMPurify from "dompurify";
import Ref from "html-tag-js/ref";

/**
 * Notification create param
 * @typedef {object} NotificationProps
 * @prop {string} [props.id]
 * @prop {string} props.title
 * @prop {string} props.message
 * @prop {string} [props.icon]
 * @prop {number} [props.time]
 * @prop {(notification: NotificationProps) => void} [props.action]
 * @prop {(notification: NotificationProps) => void} [props.onDismiss]
 * @prop {() => number} [props.progress]
 * @prop {() => loading} [props.loading = false]
 * @prop {"info"|"success"|"warning"|"error"} [props.type]
 */

// Singleton instance
let instance = null;
let notificationCounter = 0;

const notificationToastContainer = (
	<div className="notification-item-container"></div>
);

class NotificationManager {
	MAX_NOTIFICATIONS = 20;
	notifications = [];
	REFRESH_INTERVAL = 60000; // 1 minute refresh interval
	timeUpdateInterval = null;

	constructor() {
		if (instance) {
			return instance;
		}
		this.notifications = [];
		instance = this;
	}

	init() {
		document.body.appendChild(notificationToastContainer);
		this.renderNotifications();
		this.startTimeUpdates();
	}

	startTimeUpdates() {
		if (this.timeUpdateInterval) {
			clearInterval(this.timeUpdateInterval);
		}

		this.timeUpdateInterval = setInterval(() => {
			this.updateNotificationTimes();
		}, this.REFRESH_INTERVAL);
	}

	updateNotificationTimes() {
		const container = sidebarApps
			.get("notification")
			?.querySelector(".notifications-container");

		if (!container) return;

		container.querySelectorAll(".notification-time").forEach((timeElement) => {
			const notificationItem = timeElement.closest(".notification-item");
			const id = notificationItem?.id;
			if (!id) return;

			const notification = this.notifications.find((n) => n.id === id);
			if (notification) {
				timeElement.textContent = this.#formatTime(notification.time);
			}
		});
	}

	renderNotifications() {
		const container = sidebarApps
			.get("notification")
			?.querySelector(".notifications-container");
		if (!container) return;

		if (this.notifications.length === 0) {
			container.innerHTML = `<div class='empty-state'>${strings["no_unread_notifications"]}</div>`;
			return;
		}

		container.innerHTML = "";
		this.notifications.forEach((notification) => {
			container.appendChild(this.createNotificationElement(notification));
		});
	}

	/**
	 *
	 * @param {NotificationProps} notification
	 * @returns
	 */
	createNotificationElement(notification) {
		return this.#createNotification(notification, "notification");
	}

	/**
	 *
	 * @param {NotificationProps} notification
	 * @returns
	 */
	createToastNotification(notification) {
		return this.#createNotification(notification, "toast");
	}

	/**
	 *
	 * @param {NotificationProps} notification
	 * @param {"toast" | "notification"} type
	 * @returns
	 */
	#createNotification(notification, type) {
		let onDismiss;

		if (type === "toast") {
			onDismiss = (e) => {
				e.stopPropagation();
				this.#hideNotificationToast(notification);
				if (typeof notification.onDismiss === "function") {
					notification.onDismiss(notification);
				}
			};

			if (
				typeof notification.loading !== "function" ||
				!notification.loading()
			) {
				setTimeout(() => {
					if (!notificationToastContainer.get(`#${notification.id}`)) return;
					this.#hideNotificationToast(notification);
					if (typeof notification.onDismiss === "function") {
						notification.onDismiss(notification);
					}
				}, 5000);
			}
		} else {
			onDismiss = (e) => {
				e.stopPropagation();
				this.#clearNotification(notification.id);
			};
		}

		const safeIcon = this.#parseIcon(notification.icon);
		const safeTitle = this.#sanitizeText(notification.title);
		const safeMessage = this.#sanitizeText(notification.message);
		const elementRef = Ref();

		if (typeof notification.loading === "function" && notification.loading()) {
			elementRef.onref = (el) => {
				if (notification.loading()) {
					elementRef.classList.add("loading");
					const nextFrame = () => {
						if (!notification.loading()) {
							if (type === "toast") {
								this.#hideNotificationToast(notification);
								if (typeof notification.onDismiss === "function") {
									notification.onDismiss(notification);
								}
							}

							elementRef.classList.remove("loading");
						} else {
							requestAnimationFrame(nextFrame);
						}
					};

					requestAnimationFrame(nextFrame);
				}
			};
		}

		return (
			<div
				id={notification.id}
				ref={elementRef}
				className={`notification-item ${notification.type}`}
				onclick={
					notification.action ? () => notification.action(notification) : null
				}
			>
				<div className="notification-header">
					<div className="notification-icon">{safeIcon}</div>
					<div className="notification-title">
						{safeTitle}
						{type === "notification" && (
							<small className="notification-time">
								{this.#formatTime(notification.time)}
							</small>
						)}
					</div>
					<button
						className={`icon ${type === "toast" ? "clearclose" : "delete"} notification-close`}
						onclick={onDismiss}
					/>
				</div>
				<div className="notification-message">{safeMessage}</div>
			</div>
		);
	}

	/**
	 *
	 * @param {NotificationProps} notification
	 */
	closeNotification(notification) {
		this.#hideNotificationToast(notification);
		this.#clearNotification(notification.id);
	}

	/**
	 * hide notification
	 * @param {NotificationProps} notification
	 * @returns
	 */
	#hideNotificationToast(notification) {
		const notificationElement = notificationToastContainer.get(
			`#${notification.id}`,
		);
		if (!notificationElement) return;
		notificationElement.classList.add("hiding");
		setTimeout(() => notificationElement.remove(), 300);
	}

	#clearNotification(id) {
		const container = sidebarApps
			.get("notification")
			?.querySelector(".notifications-container");

		if (!container) return;

		const index = this.notifications.findIndex((n) => n.id === id);
		if (index > -1) {
			this.notifications.splice(index, 1);
			this.renderNotifications();
		}
	}

	/**
	 * Notification create
	 * @param {NotificationProps} notification
	 */
	pushNotification(notification) {
		if (!notification) {
			throw new Error("Notification param not provided");
		}

		notification = {
			...notification,
			id: `notification_${++notificationCounter}`,
			time: new Date(),
		};

		this.notifications.unshift(notification);

		// Remove oldest if exceeding limit
		if (this.notifications.length > this.MAX_NOTIFICATIONS) {
			this.notifications.pop();
		}

		if (!this.timeUpdateInterval) {
			this.startTimeUpdates();
		}

		this.renderNotifications();

		// show toast notification
		document
			.querySelector(".notification-item-container")
			?.appendChild(this.createToastNotification(notification));
	}

	#parseIcon(icon) {
		if (typeof icon !== "string" || !icon) {
			return <span className="icon notifications" />;
		}
		if (icon.startsWith("<svg")) {
			return <span className="icon" innerHTML={this.#sanitizeIcon(icon)} />;
		}
		if (icon.startsWith("data:") || icon.startsWith("http")) {
			return <img src={icon} alt="notification" width="16" height="16" />;
		}
		return <span className={`icon ${icon}`} />;
	}

	#sanitizeText(text) {
		return DOMPurify.sanitize(String(text ?? ""), {
			ALLOWED_TAGS: [],
			ALLOWED_ATTR: [],
		});
	}

	#sanitizeIcon(iconMarkup) {
		return DOMPurify.sanitize(iconMarkup, {
			USE_PROFILES: { html: true, svg: true },
			ALLOW_DATA_ATTR: false,
		});
	}

	#formatTime(date) {
		const now = new Date();
		const diff = Math.floor((now - date) / 1000);

		if (diff < 60) return "Just now";
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}d`;

		return date.toLocaleDateString();
	}

	clearAll() {
		this.notifications = [];
		this.renderNotifications();
		if (this.timeUpdateInterval) {
			clearInterval(this.timeUpdateInterval);
			this.timeUpdateInterval = null;
		}
	}
}

const notificationManager = new NotificationManager();
export default notificationManager;
