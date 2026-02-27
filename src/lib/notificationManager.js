import sidebarApps from "sidebarApps";
import DOMPurify from "dompurify";

// Singleton instance
let instance = null;

export default class NotificationManager {
	DEFAULT_ICON = `<i class="icon notifications"></i>`;
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
		document.body.appendChild(
			<div className="notification-toast-container"></div>,
		);
		this.renderNotifications();
		this.startTimeUpdates();

		sidebarApps
			.get("notification")
			?.querySelector(".notifications-container")
			.addEventListener("click", this.handleClick.bind(this));
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
			const id = notificationItem?.dataset.id;
			if (!id) return;

			const notification = this.notifications.find(
				(n) => n.id === Number.parseInt(id),
			);
			if (notification) {
				timeElement.textContent = this.formatTime(notification.time);
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

	handleClick(e) {
		const dismissButton = e.target.closest(".action-button");
		if (!dismissButton) return;

		e.stopPropagation();
		const notificationElement = dismissButton.closest(".notification-item");
		if (!notificationElement) return;

		const id = notificationElement.dataset.id;
		if (id) {
			const index = this.notifications.findIndex(
				(n) => n.id === Number.parseInt(id),
			);
			if (index > -1) {
				notificationElement.remove();
				this.notifications.splice(index, 1);
				this.renderNotifications();
			}
		}
	}

	createNotificationElement(notification) {
		const element = (
			<div
				className={`notification-item ${notification.type}`}
				data-id={notification.id}
			></div>
		);
		const safeIcon = this.sanitizeIcon(this.parseIcon(notification.icon));
		const safeTitle = this.sanitizeText(notification.title);
		const safeMessage = this.sanitizeText(notification.message);
		element.innerHTML = `
							<div class="notification-icon">
							${safeIcon}
				</div>
				<div class="notification-content">
					<div class="notification-title">
						${safeTitle}
						<span class="notification-time">${this.formatTime(notification.time)}</span>
					</div>
					<div class="notification-message">${safeMessage}</div>
					<div class="notification-actions">
							<div class="action-button">Dismiss</div>
					</div>
				</div>
							`;
		if (notification.action) {
			element.addEventListener("click", (e) => {
				if (e.target.closest(".action-button")) {
					return;
				}
				notification.action(notification);
			});
		}
		return element;
	}

	createToastNotification(notification) {
		const element = (
			<div
				className={`notification-toast ${notification.type}`}
				data-id={notification.id}
			></div>
		);
		const safeIcon = this.sanitizeIcon(this.parseIcon(notification.icon));
		const safeTitle = this.sanitizeText(notification.title);
		const safeMessage = this.sanitizeText(notification.message);
		element.innerHTML = `
							<div class="notification-icon">${safeIcon}</div>
							<div class="notification-content">
					<div class="notification-title">
						${safeTitle}
					</div>
					<div class="notification-message">${safeMessage}</div>
				</div>
				${notification.autoClose ? "" : `<span class="close-icon icon clearclose"></span>`}
				`;

		const closeIcon = element.querySelector(".close-icon");
		if (closeIcon) {
			closeIcon.addEventListener("click", (event) => {
				event.stopPropagation();
				element.remove();
			});
		}
		if (notification.action) {
			element.addEventListener("click", () =>
				notification.action(notification),
			);
		}
		if (notification.autoClose) {
			setTimeout(() => {
				element.classList.add("hiding");
				setTimeout(() => element.remove(), 300);
			}, 5000);
		}
		return element;
	}

	addNotification(notification) {
		this.notifications.unshift(notification);

		// Remove oldest if exceeding limit
		if (this.notifications.length > this.MAX_NOTIFICATIONS) {
			this.notifications.pop();
		}

		this.renderNotifications();

		// show toast notification
		document
			.querySelector(".notification-toast-container")
			?.appendChild(this.createToastNotification(notification));
	}

	pushNotification({
		title,
		message,
		icon,
		autoClose = true,
		action = null,
		type = "info",
	}) {
		const notification = {
			id: Date.now(),
			title,
			message,
			icon,
			action,
			autoClose,
			type,
			time: new Date(),
		};
		this.addNotification(notification);
	}

	parseIcon(icon) {
		if (typeof icon !== "string" || !icon) return this.DEFAULT_ICON;
		if (icon.startsWith("<svg")) return icon;
		if (icon.startsWith("data:") || icon.startsWith("http"))
			return `<img src="${icon}" alt="notification" width="16" height="16">`;
		return `<i class="icon ${icon}"></i>`;
	}

	sanitizeText(text) {
		return DOMPurify.sanitize(String(text ?? ""), {
			ALLOWED_TAGS: [],
			ALLOWED_ATTR: [],
		});
	}

	sanitizeIcon(iconMarkup) {
		return DOMPurify.sanitize(iconMarkup, {
			USE_PROFILES: { html: true, svg: true },
			ALLOW_DATA_ATTR: false,
		});
	}

	formatTime(date) {
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
