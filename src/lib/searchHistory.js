/**
 * Search and Replace History Manager
 * Manages search/replace history using localStorage
 */

const HISTORY_KEY = "acode.searchreplace.history";
const MAX_HISTORY_ITEMS = 20;

class SearchHistory {
	constructor() {
		this.history = this.loadHistory(HISTORY_KEY);
		this.searchIndex = -1; // Current position in history for search input
		this.replaceIndex = -1; // Current position in history for replace input
		this.tempSearchValue = ""; // Temporary storage for current search input
		this.tempReplaceValue = ""; // Temporary storage for current replace input
	}

	/**
	 * Load history from localStorage
	 * @param {string} key Storage key
	 * @returns {Array<string>} History items
	 */
	loadHistory(key) {
		try {
			const stored = localStorage.getItem(key);
			return stored ? JSON.parse(stored) : [];
		} catch (error) {
			console.warn("Failed to load search history:", error);
			return [];
		}
	}

	/**
	 * Save history to localStorage
	 */
	saveHistory() {
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
		} catch (error) {
			console.warn("Failed to save search history:", error);
		}
	}

	/**
	 * Add item to history
	 * @param {string} item Item to add
	 */
	addToHistory(item) {
		if (!item || typeof item !== "string" || item.trim().length === 0) {
			return;
		}

		const trimmedItem = item.trim();

		// Remove existing item if present
		this.history = this.history.filter((h) => h !== trimmedItem);

		// Add to beginning
		this.history.unshift(trimmedItem);

		// Limit history size
		this.history = this.history.slice(0, MAX_HISTORY_ITEMS);

		this.saveHistory();
	}

	/**
	 * Get history
	 * @returns {Array<string>} History items
	 */
	getHistory() {
		return [...this.history];
	}

	/**
	 * Clear all history
	 */
	clearHistory() {
		this.history = [];
		this.saveHistory();
	}

	/**
	 * Navigate up in search history (terminal-like)
	 * @param {string} currentValue Current input value
	 * @returns {string} Previous history item or current value
	 */
	navigateSearchUp(currentValue) {
		if (this.history.length === 0) return currentValue;

		// Store current value if we're at the beginning
		if (this.searchIndex === -1) {
			this.tempSearchValue = currentValue;
			this.searchIndex = this.history.length - 1;
		} else if (this.searchIndex > 0) {
			this.searchIndex--;
		}

		return this.history[this.searchIndex] || currentValue;
	}

	/**
	 * Navigate down in search history (terminal-like)
	 * @param {string} currentValue Current input value
	 * @returns {string} Next history item or original value
	 */
	navigateSearchDown(currentValue) {
		if (this.history.length === 0 || this.searchIndex === -1) {
			return currentValue;
		}

		this.searchIndex++;

		// If we've gone past the end, return to original value
		if (this.searchIndex >= this.history.length) {
			this.searchIndex = -1;
			return this.tempSearchValue;
		}

		return this.history[this.searchIndex];
	}

	/**
	 * Navigate up in replace history (terminal-like)
	 * @param {string} currentValue Current input value
	 * @returns {string} Previous history item or current value
	 */
	navigateReplaceUp(currentValue) {
		if (this.history.length === 0) return currentValue;

		// Store current value if we're at the beginning
		if (this.replaceIndex === -1) {
			this.tempReplaceValue = currentValue;
			this.replaceIndex = this.history.length - 1;
		} else if (this.replaceIndex > 0) {
			this.replaceIndex--;
		}

		return this.history[this.replaceIndex] || currentValue;
	}

	/**
	 * Navigate down in replace history (terminal-like)
	 * @param {string} currentValue Current input value
	 * @returns {string} Next history item or original value
	 */
	navigateReplaceDown(currentValue) {
		if (this.history.length === 0 || this.replaceIndex === -1) {
			return currentValue;
		}

		this.replaceIndex++;

		// If we've gone past the end, return to original value
		if (this.replaceIndex >= this.history.length) {
			this.replaceIndex = -1;
			return this.tempReplaceValue;
		}

		return this.history[this.replaceIndex];
	}

	/**
	 * Reset search history navigation
	 */
	resetSearchNavigation() {
		this.searchIndex = -1;
		this.tempSearchValue = "";
	}

	/**
	 * Reset replace history navigation
	 */
	resetReplaceNavigation() {
		this.replaceIndex = -1;
		this.tempReplaceValue = "";
	}

	/**
	 * Reset all navigation state
	 */
	resetAllNavigation() {
		this.resetSearchNavigation();
		this.resetReplaceNavigation();
	}
}

export default new SearchHistory();
