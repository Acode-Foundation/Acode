import "./style.scss";

/**@type {HTMLElement | null} */
let $statusBar = null;

/**@type {number | null} */
let hideTimeout = null;

/**
 * @typedef {Object} ProgressItem
 * @property {string} title - Task title
 * @property {string} [message] - Current message
 * @property {number} [percentage] - Progress percentage (0-100)
 */

/**@type {Map<string, ProgressItem>} */
const activeProgress = new Map();

/**@type {string | null} */
let currentServerId = null;

/**@type {string | null} */
let currentServerLabel = null;

/**
 * @typedef {Object} LspStatusOptions
 * @property {string} message - The status message to display
 * @property {string} [icon] - Optional icon class name
 * @property {'info' | 'success' | 'warning' | 'error'} [type='info'] - Status type
 * @property {number | false} [duration=0] - Duration in ms, 0 for default (5000ms), false for persistent
 * @property {boolean} [showProgress=false] - Whether to show a progress indicator
 * @property {number} [progress] - Progress percentage (0-100)
 * @property {string} [title] - Optional title for the status
 * @property {string} [id] - Unique identifier for progress tracking
 */

/**
 * Ensure the status bar exists
 * @returns {HTMLElement}
 */
function ensureStatusBar() {
	if ($statusBar && document.body.contains($statusBar)) {
		return $statusBar;
	}

	$statusBar = (
		<div id="lsp-status-bar" className="lsp-status info">
			<div className="lsp-status-content">
				<span className="lsp-status-icon icon autorenew"></span>
				<div className="lsp-status-text">
					<span className="lsp-status-title"></span>
					<span className="lsp-status-message"></span>
				</div>
				<div className="lsp-status-progress">
					<span className="lsp-status-progress-text"></span>
				</div>
			</div>
			<button
				type="button"
				className="lsp-status-close icon clearclose"
				onclick={hideStatusBar}
				aria-label="Close"
			></button>
		</div>
	);

	// Find the quicktools footer to insert before it
	const $footer = document.getElementById("quick-tools");
	if ($footer && $footer.parentNode) {
		$footer.parentNode.insertBefore($statusBar, $footer);
	} else {
		// Fallback: append to app
		const $app = document.getElementById("app") || document.body;
		$app.appendChild($statusBar);
	}

	return $statusBar;
}

/**
 * Build aggregated message from all active progress items
 * @returns {{ message: string, avgProgress: number | null, taskCount: number }}
 */
function buildAggregatedStatus() {
	const items = Array.from(activeProgress.values());
	const taskCount = items.length;

	if (taskCount === 0) {
		return { message: "", avgProgress: null, taskCount: 0 };
	}

	// Calculate average progress for items that have percentage
	const itemsWithProgress = items.filter(
		(item) => typeof item.percentage === "number",
	);
	const avgProgress =
		itemsWithProgress.length > 0
			? Math.round(
					itemsWithProgress.reduce(
						(sum, item) => sum + (item.percentage || 0),
						0,
					) / itemsWithProgress.length,
				)
			: null;

	// Build message
	if (taskCount === 1) {
		const item = items[0];
		const parts = [];
		if (item.message) {
			parts.push(item.message);
		} else if (item.title) {
			parts.push(item.title);
		}
		return { message: parts.join(" "), avgProgress, taskCount };
	}

	// Multiple tasks - show count and maybe the most recent message
	const latestWithMessage = items.filter((item) => item.message).pop();
	const message = latestWithMessage
		? `${taskCount} tasks: ${latestWithMessage.message}`
		: `${taskCount} tasks running`;

	return { message, avgProgress, taskCount };
}

/**
 * Update the status bar display
 */
function updateStatusBarDisplay() {
	const bar = $statusBar;
	if (!bar) return;

	const { message, avgProgress, taskCount } = buildAggregatedStatus();

	if (taskCount === 0) {
		hideStatusBar();
		return;
	}

	const $title = bar.querySelector(".lsp-status-title");
	const $message = bar.querySelector(".lsp-status-message");
	const $progressText = bar.querySelector(".lsp-status-progress-text");
	const $progressContainer = bar.querySelector(".lsp-status-progress");
	const $icon = bar.querySelector(".lsp-status-icon");

	if ($title) $title.textContent = currentServerLabel || "";
	if ($message) $message.textContent = message;

	if (avgProgress !== null && $progressText && $progressContainer) {
		$progressText.textContent = `${avgProgress}%`;
		$progressContainer.style.display = "";
	} else if ($progressContainer) {
		$progressContainer.style.display = "none";
	}

	// Show spinning icon while progress is active
	if ($icon) {
		$icon.className = "lsp-status-icon icon autorenew";
	}

	bar.className = "lsp-status info";
	bar.classList.remove("hiding");
}

/**
 * Hide the status bar
 */
function hideStatusBar() {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}

	if ($statusBar) {
		$statusBar.classList.add("hiding");
		setTimeout(() => {
			if ($statusBar) {
				$statusBar.remove();
				$statusBar = null;
			}
		}, 300);
	}
}

/**
 * Show LSP status notification
 * @param {LspStatusOptions} options - Status options
 * @returns {string | undefined} The status ID for later updates/removal
 */
export function showLspStatus(options) {
	const {
		message,
		icon = "autorenew",
		type = "info",
		duration = 0,
		showProgress = false,
		progress,
		title,
		id,
	} = options;

	// Clear any existing hide timeout
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}

	// If this is a progress item (has id), track it
	if (id && id.includes("-progress-")) {
		// Extract server info from id (format: serverId-progress-token)
		const serverMatch = id.match(/^(.+?)-progress-/);
		if (serverMatch) {
			currentServerId = serverMatch[1];
			currentServerLabel = title || currentServerId;
		}

		activeProgress.set(id, {
			title: title || "",
			message: message || "",
			percentage: progress,
		});

		ensureStatusBar();
		updateStatusBarDisplay();
		return id;
	}

	// For non-progress messages (errors, warnings, etc.)
	const bar = ensureStatusBar();

	const $title = bar.querySelector(".lsp-status-title");
	const $message = bar.querySelector(".lsp-status-message");
	const $progressText = bar.querySelector(".lsp-status-progress-text");
	const $progressContainer = bar.querySelector(".lsp-status-progress");
	const $icon = bar.querySelector(".lsp-status-icon");

	if ($title) $title.textContent = title || "";
	if ($message) $message.textContent = message;

	const hasProgress = showProgress && typeof progress === "number";
	if (hasProgress && $progressText && $progressContainer) {
		$progressText.textContent = `${Math.round(progress)}%`;
		$progressContainer.style.display = "";
	} else if ($progressContainer) {
		$progressContainer.style.display = "none";
	}

	if ($icon) {
		$icon.className = `lsp-status-icon icon ${icon}`;
	}

	bar.className = `lsp-status ${type}`;
	bar.classList.remove("hiding");

	// Auto-hide after duration unless duration is false
	if (duration !== false) {
		const ms = duration || 5000;
		hideTimeout = window.setTimeout(() => {
			// Only hide if no progress is active
			if (activeProgress.size === 0) {
				hideStatusBar();
			}
		}, ms);
	}

	return id;
}

/**
 * Hide a specific progress item by ID
 * @param {string} id - The progress ID to hide
 */
export function hideStatus(id) {
	if (activeProgress.has(id)) {
		activeProgress.delete(id);

		if (activeProgress.size === 0) {
			// All progress complete - hide after a brief delay
			hideTimeout = window.setTimeout(() => {
				hideStatusBar();
			}, 500);
		} else {
			updateStatusBarDisplay();
		}
	}
}

/**
 * Hide the LSP status bar (legacy support - hides all)
 */
export function hideLspStatus() {
	activeProgress.clear();
	hideStatusBar();
}

/**
 * Update a progress item
 * @param {Partial<LspStatusOptions> & { id?: string }} options - Options to update
 * @returns {string | null} The status ID
 */
export function updateLspStatus(options) {
	const { id, message, progress } = options;

	if (!id || !activeProgress.has(id)) {
		return null;
	}

	const item = activeProgress.get(id);
	if (item) {
		if (message !== undefined) item.message = message;
		if (progress !== undefined) item.percentage = progress;
		activeProgress.set(id, item);
		updateStatusBarDisplay();
	}

	return id;
}

/**
 * Check if status bar is currently visible
 * @returns {boolean}
 */
export function isLspStatusVisible() {
	return $statusBar !== null && document.body.contains($statusBar);
}

/**
 * Get count of active progress items
 * @returns {number}
 */
export function getActiveStatusCount() {
	return activeProgress.size;
}

/**
 * Check if a specific progress item exists
 * @param {string} id - The progress ID to check
 * @returns {boolean}
 */
export function hasStatus(id) {
	return activeProgress.has(id);
}

export default {
	show: showLspStatus,
	hide: hideLspStatus,
	hideById: hideStatus,
	update: updateLspStatus,
	isVisible: isLspStatusVisible,
	getActiveCount: getActiveStatusCount,
	has: hasStatus,
};
