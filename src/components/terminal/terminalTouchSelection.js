/**
 * Touch Selection for Terminal
 */
import "./terminalTouchSelection.css";

export default class TerminalTouchSelection {
	constructor(terminal, container, options = {}) {
		this.terminal = terminal;
		this.container = container;
		this.options = {
			tapHoldDuration: 600,
			moveThreshold: 8,
			handleSize: 24,
			hapticFeedback: true,
			showContextMenu: true,
			fingerOffset: 40, // Offset in pixels to position selection above finger during drag
			...options,
		};

		// Selection state
		this.isSelecting = false;
		this.isHandleDragging = false;
		this.selectionStart = null;
		this.selectionEnd = null;
		this.currentSelection = null;

		// Touch tracking
		this.touchStartTime = 0;
		this.touchStartPos = { x: 0, y: 0 };
		this.initialTouchPos = { x: 0, y: 0 };
		this.tapHoldTimeout = null;
		this.dragHandle = null;

		// Zoom tracking
		this.pinchStartDistance = 0;
		this.lastPinchDistance = 0;
		this.isPinching = false;
		this.initialFontSize = 0;
		this.lastZoomTime = 0;
		this.zoomThrottle = 50; // ms

		// DOM elements
		this.selectionOverlay = null;
		this.startHandle = null;
		this.endHandle = null;
		this.contextMenu = null;

		// Cell dimensions cache
		this.cellDimensions = { width: 0, height: 0 };

		// Event handlers
		this.boundHandlers = {};

		// Focus tracking
		this.wasFocusedBeforeSelection = false;
		this.contextMenuShouldStayVisible = false;

		// Selection protection during keyboard events
		this.selectionProtected = false;
		this.protectionTimeout = null;

		this.init();
	}

	init() {
		this.createSelectionOverlay();
		this.createHandles();
		this.attachEventListeners();
		this.updateCellDimensions();
	}

	createSelectionOverlay() {
		this.selectionOverlay = document.createElement("div");
		this.selectionOverlay.className = "terminal-selection-overlay";
		this.selectionOverlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
      overflow: hidden;
    `;
		this.container.appendChild(this.selectionOverlay);
	}

	createHandles() {
		this.startHandle = this.createHandle("start");
		this.startHandle.style.cssText += `
      transform: rotate(135deg);
      border-radius: 50% 50% 50% 0;
    `;

		this.endHandle = this.createHandle("end");
		this.endHandle.style.cssText += `
      transform: rotate(135deg);
      border-radius: 50% 50% 50% 0;
    `;

		this.selectionOverlay.appendChild(this.startHandle);
		this.selectionOverlay.appendChild(this.endHandle);
	}

	createHandle(type) {
		const handle = document.createElement("div");
		handle.className = `terminal-selection-handle terminal-selection-handle-${type}`;
		handle.style.cssText = `
      position: absolute;
      width: ${this.options.handleSize}px;
      height: ${this.options.handleSize}px;
      background: #2196F3;
      border: 2px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: none;
      pointer-events: auto;
      touch-action: none;
      z-index: 101;
      cursor: grab;
    `;

		// Ensure dataset is properly set
		handle.dataset.handleType = type;

		return handle;
	}

	attachEventListeners() {
		// Terminal touch events
		this.boundHandlers.terminalTouchStart =
			this.onTerminalTouchStart.bind(this);
		this.boundHandlers.terminalTouchMove = this.onTerminalTouchMove.bind(this);
		this.boundHandlers.terminalTouchEnd = this.onTerminalTouchEnd.bind(this);

		this.terminal.element.addEventListener(
			"touchstart",
			this.boundHandlers.terminalTouchStart,
			{ passive: false },
		);
		this.terminal.element.addEventListener(
			"touchmove",
			this.boundHandlers.terminalTouchMove,
			{ passive: false },
		);
		this.terminal.element.addEventListener(
			"touchend",
			this.boundHandlers.terminalTouchEnd,
			{ passive: false },
		);

		// Handle touch events
		this.boundHandlers.handleTouchStart = this.onHandleTouchStart.bind(this);
		this.boundHandlers.handleTouchMove = this.onHandleTouchMove.bind(this);
		this.boundHandlers.handleTouchEnd = this.onHandleTouchEnd.bind(this);

		this.startHandle.addEventListener(
			"touchstart",
			this.boundHandlers.handleTouchStart,
			{ passive: false },
		);
		this.startHandle.addEventListener(
			"touchmove",
			this.boundHandlers.handleTouchMove,
			{ passive: false },
		);
		this.startHandle.addEventListener(
			"touchend",
			this.boundHandlers.handleTouchEnd,
			{ passive: false },
		);

		this.endHandle.addEventListener(
			"touchstart",
			this.boundHandlers.handleTouchStart,
			{ passive: false },
		);
		this.endHandle.addEventListener(
			"touchmove",
			this.boundHandlers.handleTouchMove,
			{ passive: false },
		);
		this.endHandle.addEventListener(
			"touchend",
			this.boundHandlers.handleTouchEnd,
			{ passive: false },
		);

		// Selection change listener
		this.boundHandlers.selectionChange = this.onSelectionChange.bind(this);
		this.terminal.onSelectionChange(this.boundHandlers.selectionChange);

		// Click outside to clear selection - only within terminal area
		this.boundHandlers.terminalAreaTouchStart =
			this.onTerminalAreaTouchStart.bind(this);
		this.terminal.element.addEventListener(
			"touchstart",
			this.boundHandlers.terminalAreaTouchStart,
			{ passive: false },
		);

		// Orientation change
		this.boundHandlers.orientationChange = this.onOrientationChange.bind(this);
		window.addEventListener(
			"orientationchange",
			this.boundHandlers.orientationChange,
		);
		window.addEventListener("resize", this.boundHandlers.orientationChange);

		// Terminal scroll listener
		this.boundHandlers.terminalScroll = this.onTerminalScroll.bind(this);
		this.terminal.element.addEventListener(
			"scroll",
			this.boundHandlers.terminalScroll,
			{ passive: true },
		);

		// Terminal resize listener (for keyboard events)
		this.boundHandlers.terminalResize = this.onTerminalResize.bind(this);
		this.terminal.onResize(this.boundHandlers.terminalResize);
	}

	onTerminalTouchStart(event) {
		// Handle pinch zoom
		if (event.touches.length === 2) {
			event.preventDefault();
			this.startPinchZoom(event);
			return;
		}

		// Only handle single touch for selection
		if (event.touches.length !== 1) return;

		const touch = event.touches[0];
		this.touchStartTime = Date.now();
		this.touchStartPos = { x: touch.clientX, y: touch.clientY };
		this.initialTouchPos = { x: touch.clientX, y: touch.clientY };

		// If already selecting, don't start new selection
		if (this.isSelecting) {
			return;
		}

		// Check if touch is near screen edge (likely Android back gesture)
		if (this.isEdgeGesture(touch)) {
			return;
		}

		// Clear any existing tap-hold timeout
		if (this.tapHoldTimeout) {
			clearTimeout(this.tapHoldTimeout);
		}

		// Start tap-hold timer
		this.tapHoldTimeout = setTimeout(() => {
			if (!this.isSelecting && !this.isPinching) {
				this.startSelection(touch);
			}
		}, this.options.tapHoldDuration);
	}

	onTerminalTouchMove(event) {
		// Handle pinch zoom
		if (event.touches.length === 2) {
			event.preventDefault();
			this.handlePinchZoom(event);
			return;
		}

		if (event.touches.length !== 1) return;

		// Don't handle single touch if we're pinching
		if (this.isPinching) return;

		const touch = event.touches[0];
		const deltaX = Math.abs(touch.clientX - this.touchStartPos.x);
		const deltaY = Math.abs(touch.clientY - this.touchStartPos.y);
		const horizontalDelta = touch.clientX - this.touchStartPos.x;

		// Check if this looks like a back gesture (started near edge and moving horizontally inward)
		if (
			this.isEdgeGesture(this.initialTouchPos) &&
			Math.abs(horizontalDelta) > deltaY &&
			deltaX > this.options.moveThreshold
		) {
			// This looks like a back gesture, cancel selection
			if (this.tapHoldTimeout) {
				clearTimeout(this.tapHoldTimeout);
				this.tapHoldTimeout = null;
			}
			return;
		}

		// If significant movement, cancel tap-hold
		if (
			deltaX > this.options.moveThreshold ||
			deltaY > this.options.moveThreshold
		) {
			if (this.tapHoldTimeout) {
				clearTimeout(this.tapHoldTimeout);
				this.tapHoldTimeout = null;
			}

			// If we're selecting, extend selection
			if (this.isSelecting && !this.isHandleDragging) {
				event.preventDefault();
				this.extendSelection(touch);
			}
		}
	}

	onTerminalTouchEnd(event) {
		// Handle end of pinch zoom
		if (this.isPinching) {
			this.endPinchZoom();
			return;
		}

		if (this.tapHoldTimeout) {
			clearTimeout(this.tapHoldTimeout);
			this.tapHoldTimeout = null;
		}

		// If we were selecting and not dragging handles, finalize selection
		if (this.isSelecting && !this.isHandleDragging) {
			this.finalizeSelection();
		} else if (!this.isSelecting) {
			// Only focus terminal on touch end if not selecting and terminal was already focused
			// This prevents keyboard popup when just starting selection
			const currentlyFocused = this.isTerminalFocused();
			if (currentlyFocused) {
				// Terminal is already focused, maintain focus
				this.terminal.focus();
			}
			// If terminal wasn't focused, don't focus it (prevents keyboard popup)
		}
	}

	onHandleTouchStart(event) {
		event.preventDefault();
		event.stopPropagation();

		if (event.touches.length !== 1) return;

		// Ensure we have the correct handle type
		let handleType = event.target.dataset.handleType;
		if (!handleType) {
			// Fallback to checking which handle was touched
			if (
				event.target === this.startHandle ||
				this.startHandle.contains(event.target)
			) {
				handleType = "start";
			} else if (
				event.target === this.endHandle ||
				this.endHandle.contains(event.target)
			) {
				handleType = "end";
			}
		}

		if (!handleType) {
			console.warn("Could not determine handle type for drag");
			return;
		}

		this.isHandleDragging = true;
		this.dragHandle = handleType;

		// Store the initial touch position for delta calculations
		const touch = event.touches[0];
		this.initialTouchPos = { x: touch.clientX, y: touch.clientY };

		// Update handle appearance - ensure we're updating the correct handle
		const targetHandle =
			handleType === "start" ? this.startHandle : this.endHandle;
		targetHandle.style.cursor = "grabbing";
		if (!targetHandle.style.transform.includes("scale")) {
			targetHandle.style.transform += " scale(1.2)";
		}
	}

	onHandleTouchMove(event) {
		if (!this.isHandleDragging || event.touches.length !== 1) return;

		event.preventDefault();
		event.stopPropagation();

		const touch = event.touches[0];

		// Check if there's significant movement before updating selection
		const deltaX = Math.abs(touch.clientX - this.initialTouchPos.x);
		const deltaY = Math.abs(touch.clientY - this.initialTouchPos.y);

		// Only update selection if there's significant movement (prevents micro-movements)
		if (
			deltaX < this.options.moveThreshold &&
			deltaY < this.options.moveThreshold
		) {
			return;
		}

		// Apply finger offset for better visibility during drag
		const adjustedTouch = {
			clientX: touch.clientX,
			clientY: touch.clientY - this.options.fingerOffset,
		};

		const coords = this.touchToTerminalCoords(adjustedTouch);

		if (coords) {
			// Allow handle swapping but manage it properly
			if (this.dragHandle === "start") {
				this.selectionStart = coords;

				// If start goes past end, swap the handles logically
				if (
					this.selectionEnd &&
					(coords.row > this.selectionEnd.row ||
						(coords.row === this.selectionEnd.row &&
							coords.col > this.selectionEnd.col))
				) {
					// Swap internally but keep drag handle reference
					const temp = this.selectionStart;
					this.selectionStart = this.selectionEnd;
					this.selectionEnd = temp;
					this.dragHandle = "end"; // Continue dragging as end handle
				}
			} else {
				this.selectionEnd = coords;

				// If end goes before start, swap the handles logically
				if (
					this.selectionStart &&
					(coords.row < this.selectionStart.row ||
						(coords.row === this.selectionStart.row &&
							coords.col < this.selectionStart.col))
				) {
					// Swap internally but keep drag handle reference
					const temp = this.selectionEnd;
					this.selectionEnd = this.selectionStart;
					this.selectionStart = temp;
					this.dragHandle = "start"; // Continue dragging as start handle
				}
			}
			this.updateSelection();
		}
	}

	onHandleTouchEnd(event) {
		if (!this.isHandleDragging) return;

		event.preventDefault();
		event.stopPropagation();

		// Store the current drag handle before clearing
		const currentDragHandle = this.dragHandle;

		this.isHandleDragging = false;
		this.dragHandle = null;

		// Reset handle appearance - reset both handles to be safe
		const handles = [this.startHandle, this.endHandle];
		handles.forEach((handle) => {
			handle.style.cursor = "grab";
			// More robust transform cleanup
			handle.style.transform = handle.style.transform
				.replace(/\s*scale\([^)]*\)/g, "")
				.trim();
		});

		this.finalizeSelection();
	}

	onSelectionChange() {
		if (!this.isSelecting) return;

		const selection = this.terminal.getSelection();
		if (selection && selection.length > 0) {
			this.currentSelection = selection;
			this.updateHandlePositions();
		}
	}

	onTerminalAreaTouchStart(event) {
		// Clear selection if touching terminal area while selecting, except on handles or context menu
		if (this.isSelecting) {
			// Don't clear selection if it's protected (during keyboard events)
			if (this.selectionProtected) {
				return;
			}

			// Don't interfere with context menu at all
			if (this.contextMenu && this.contextMenu.style.display === "flex") {
				// Context menu is visible, check if touching it
				const rect = this.contextMenu.getBoundingClientRect();
				const touchX = event.touches[0].clientX;
				const touchY = event.touches[0].clientY;

				if (
					touchX >= rect.left &&
					touchX <= rect.right &&
					touchY >= rect.top &&
					touchY <= rect.bottom
				) {
					// Touching context menu area, don't clear selection
					return;
				}
			}

			const isHandleTouch =
				this.startHandle.contains(event.target) ||
				this.endHandle.contains(event.target);

			// Only clear if touching within terminal but not on handles
			if (!isHandleTouch && this.terminal.element.contains(event.target)) {
				this.clearSelection();
			}
		}
	}

	onOrientationChange() {
		// Update cell dimensions and handle positions after orientation change
		setTimeout(() => {
			this.updateCellDimensions();
			if (this.isSelecting) {
				this.updateHandlePositions();
			}
		}, 100);
	}

	onTerminalScroll() {
		// Update handle positions when terminal is scrolled
		if (this.isSelecting) {
			this.updateHandlePositions();
			// Hide context menu if it's open during scroll
			if (this.contextMenu && this.contextMenu.style.display === "flex") {
				this.hideContextMenu();
			}
		}
	}

	onTerminalResize(size) {
		// Handle terminal resize (keyboard open/close on Android)
		setTimeout(() => {
			this.updateCellDimensions();
			if (this.isSelecting) {
				// Don't clear selection if it's protected (during keyboard events)
				if (this.selectionProtected) {
					// Just update handle positions during protected period
					this.updateHandlePositions();
					return;
				}

				// Only clear selection if it becomes invalid due to actual content resize
				// Don't clear selection for keyboard-related resizes
				if (
					this.selectionStart &&
					this.selectionEnd &&
					(this.selectionStart.row >= size.rows ||
						this.selectionEnd.row >= size.rows)
				) {
					this.clearSelection();
				} else if (this.isSelecting) {
					// Maintain selection and update handle positions
					this.updateHandlePositions();
					// Temporarily hide context menu during resize but keep selection
					if (this.contextMenu && this.contextMenu.style.display === "flex") {
						this.hideContextMenu();
					}
					// Re-show context menu after resize if selection is still active
					setTimeout(() => {
						if (this.isSelecting && this.options.showContextMenu) {
							this.showContextMenu();
						}
					}, 100);
				}
			}
		}, 50);
	}

	startSelection(touch) {
		const coords = this.touchToTerminalCoords(touch);
		if (!coords) return;

		// Store initial focus state
		this.wasFocusedBeforeSelection = this.isTerminalFocused();

		// Protect selection from being cancelled by keyboard events
		this.selectionProtected = true;
		if (this.protectionTimeout) {
			clearTimeout(this.protectionTimeout);
		}
		// Remove protection after keyboard events have settled
		this.protectionTimeout = setTimeout(() => {
			this.selectionProtected = false;
		}, 1000);

		this.isSelecting = true;

		// Try to auto-select word at touch position
		const wordBounds = this.getWordBoundsAt(coords);
		if (wordBounds) {
			// Select the entire word
			this.selectionStart = wordBounds.start;
			this.selectionEnd = wordBounds.end;
		} else {
			// Fallback to single character selection
			this.selectionStart = coords;
			this.selectionEnd = coords;
		}

		// Clear any existing selection
		this.terminal.clearSelection();

		// Apply the selection
		this.updateSelection();

		// Store current selection for immediate access
		this.currentSelection = this.terminal.getSelection();

		// Show handles
		this.showHandles();

		if (this.options.showContextMenu) {
			this.showContextMenu();
		}

		// Haptic feedback
		if (this.options.hapticFeedback && navigator.vibrate) {
			navigator.vibrate(50);
		}

		// Don't change focus state during selection
		// Terminal should maintain its current focus state
	}

	extendSelection(touch) {
		const coords = this.touchToTerminalCoords(touch);
		if (!coords) return;

		this.selectionEnd = coords;
		this.updateSelection();
	}

	updateSelection() {
		if (!this.selectionStart || !this.selectionEnd) return;

		const start = this.selectionStart;
		const end = this.selectionEnd;

		// Ensure start is before end
		let startRow = start.row;
		let startCol = start.col;
		let endRow = end.row;
		let endCol = end.col;

		if (startRow > endRow || (startRow === endRow && startCol > endCol)) {
			[startRow, startCol, endRow, endCol] = [
				endRow,
				endCol,
				startRow,
				startCol,
			];
		}

		// Calculate selection length
		const length = this.calculateSelectionLength(
			startRow,
			startCol,
			endRow,
			endCol,
		);

		// Clear and set new selection
		this.terminal.clearSelection();
		this.terminal.select(startCol, startRow, length);

		this.updateHandlePositions();

		// Ensure context menu stays visible if it should be
		if (this.contextMenuShouldStayVisible && this.options.showContextMenu) {
			this.showContextMenu();
		}
	}

	calculateSelectionLength(startRow, startCol, endRow, endCol) {
		if (startRow === endRow) {
			return endCol - startCol + 1;
		}

		const cols = this.terminal.cols;
		let length = cols - startCol; // First row
		length += (endRow - startRow - 1) * cols; // Middle rows
		length += endCol + 1; // Last row

		return length;
	}

	finalizeSelection() {
		if (this.options.showContextMenu && this.currentSelection) {
			this.showContextMenu();
		}
	}

	showHandles() {
		this.startHandle.style.display = "block";
		this.endHandle.style.display = "block";
		this.updateHandlePositions();
	}

	hideHandles() {
		this.startHandle.style.display = "none";
		this.endHandle.style.display = "none";
	}

	updateHandlePositions() {
		if (!this.selectionStart || !this.selectionEnd) return;

		let logicalStart, logicalEnd;
		if (
			this.selectionStart.row < this.selectionEnd.row ||
			(this.selectionStart.row === this.selectionEnd.row &&
				this.selectionStart.col <= this.selectionEnd.col)
		) {
			logicalStart = this.selectionStart;
			logicalEnd = this.selectionEnd;
		} else {
			logicalStart = this.selectionEnd;
			logicalEnd = this.selectionStart;
		}

		const startPos = this.terminalCoordsToPixels(logicalStart);
		const endPos = this.terminalCoordsToPixels(logicalEnd);

		// Show/hide start handle at logical start position
		if (startPos) {
			this.startHandle.style.display = "block";
			this.startHandle.style.left = `${startPos.x - this.options.handleSize / 2 - 0.1}px`;
			this.startHandle.style.top = `${startPos.y + this.cellDimensions.height + 4}px`;
		} else {
			this.startHandle.style.display = "none";
		}

		// Show/hide end handle at logical end position
		if (endPos) {
			this.endHandle.style.display = "block";
			this.endHandle.style.left = `${endPos.x + this.cellDimensions.width - this.options.handleSize / 2 - 1}px`;
			this.endHandle.style.top = `${endPos.y + this.cellDimensions.height + 4}px`;
		} else {
			this.endHandle.style.display = "none";
		}
	}

	showContextMenu() {
		if (!this.contextMenu) {
			this.createContextMenu();
		}

		// Mark that context menu should stay visible
		this.contextMenuShouldStayVisible = true;

		// Position context menu - center it on selection with viewport bounds checking
		const startPos = this.terminalCoordsToPixels(this.selectionStart);
		const endPos = this.terminalCoordsToPixels(this.selectionEnd);

		if (startPos || endPos) {
			// Use whichever position is available, or center between them
			let centerX, baseY;

			if (startPos && endPos) {
				centerX = (startPos.x + endPos.x) / 2;
				// Position below the lower of the two positions
				baseY = Math.max(startPos.y, endPos.y);
			} else if (startPos) {
				centerX = startPos.x;
				baseY = startPos.y;
			} else {
				centerX = endPos.x;
				baseY = endPos.y;
			}

			const menuWidth = this.contextMenu.offsetWidth || 200;
			const menuHeight = this.contextMenu.offsetHeight || 50;

			const containerRect = this.container.getBoundingClientRect();

			// Calculate initial position
			let menuX = centerX - menuWidth / 2;
			let menuY = baseY + this.cellDimensions.height + 40;

			// Ensure menu stays within terminal bounds horizontally
			const minX = 10; // padding from left edge
			const maxX = containerRect.width - menuWidth - 10; // padding from right edge
			menuX = Math.max(minX, Math.min(menuX, maxX));

			// Ensure menu stays within terminal bounds vertically
			const maxY = containerRect.height - menuHeight - 10; // padding from bottom
			if (menuY > maxY) {
				// If menu would go below terminal, position it above the selection
				const topY =
					startPos && endPos ? Math.min(startPos.y, endPos.y) : baseY;
				menuY = topY - menuHeight - 10;
			}

			// Final bounds check
			menuY = Math.max(10, Math.min(menuY, maxY));

			this.contextMenu.style.left = `${menuX}px`;
			this.contextMenu.style.top = `${menuY}px`;
			this.contextMenu.style.display = "flex";
		}
	}

	createContextMenu() {
		this.contextMenu = document.createElement("div");
		this.contextMenu.className = "terminal-context-menu";

		// Add menu items
		const menuItems = [
			{ label: strings["copy"], action: this.copySelection.bind(this) },
			{ label: strings["paste"], action: this.pasteFromClipboard.bind(this) },
			{ label: "More...", action: this.showMoreOptions.bind(this) },
		];

		menuItems.forEach((item) => {
			const button = document.createElement("button");
			button.textContent = item.label;

			// Flag to prevent multiple activations
			let actionExecuted = false;

			// Handle touch interactions
			button.addEventListener("touchstart", (e) => {
				e.preventDefault();
				e.stopPropagation();
				actionExecuted = false;
			});

			button.addEventListener("touchend", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (!actionExecuted) {
					actionExecuted = true;
					item.action();
				}
			});

			// Handle mouse interactions
			button.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				actionExecuted = false;
			});

			button.addEventListener("mouseup", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (!actionExecuted) {
					actionExecuted = true;
					item.action();
				}
			});

			// Prevent default click
			button.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
			});

			this.contextMenu.appendChild(button);
		});

		this.selectionOverlay.appendChild(this.contextMenu);
	}

	hideContextMenu() {
		// Only hide if explicitly requested or if context menu should not stay visible
		if (this.contextMenu && !this.contextMenuShouldStayVisible) {
			this.contextMenu.style.display = "none";
		}
	}

	forceHideContextMenu() {
		// Force hide context menu regardless of flags
		if (this.contextMenu) {
			this.contextMenu.style.display = "none";
			this.contextMenuShouldStayVisible = false;
		}
	}

	copySelection() {
		// Store selection before clearing
		const selectionText = this.currentSelection || this.terminal.getSelection();

		if (selectionText && cordova?.plugins?.clipboard) {
			cordova.plugins.clipboard.copy(selectionText);
		}

		this.forceClearSelection();
	}

	pasteFromClipboard() {
		if (cordova?.plugins?.clipboard) {
			cordova.plugins.clipboard.paste((text) => {
				this.terminal.paste(text);
				this.forceClearSelection();
			});
		}
	}

	showMoreOptions() {
		// Implement additional options if needed
		window.toast("More options are not implemented yet.");
		this.forceClearSelection();
	}

	clearSelection() {
		// Don't clear if selection is protected
		if (this.selectionProtected) {
			return;
		}

		// Store focus state before clearing
		const shouldRestoreFocus =
			this.wasFocusedBeforeSelection && this.isSelecting;

		this.isSelecting = false;
		this.isHandleDragging = false;
		this.selectionStart = null;
		this.selectionEnd = null;
		this.currentSelection = null;
		this.dragHandle = null;

		this.terminal.clearSelection();
		this.hideHandles();
		this.forceHideContextMenu();

		if (this.tapHoldTimeout) {
			clearTimeout(this.tapHoldTimeout);
			this.tapHoldTimeout = null;
		}

		// Clear protection timeout
		if (this.protectionTimeout) {
			clearTimeout(this.protectionTimeout);
			this.protectionTimeout = null;
		}
		this.selectionProtected = false;

		// Only restore focus if explicitly clearing selection (not due to keyboard close)
		// and if terminal was focused before selection
		if (shouldRestoreFocus && !this.isTerminalFocused()) {
			setTimeout(() => {
				if (!this.isSelecting) {
					this.terminal.focus();
				}
			}, 150);
		}

		// Reset focus tracking
		this.wasFocusedBeforeSelection = false;
	}

	forceClearSelection() {
		// Temporarily disable protection to force clear
		const wasProtected = this.selectionProtected;
		this.selectionProtected = false;
		this.clearSelection();
		// Don't restore protection state since we're clearing
	}

	touchToTerminalCoords(touch) {
		const rect = this.terminal.element.getBoundingClientRect();
		const x = touch.clientX - rect.left;
		const y = touch.clientY - rect.top;

		if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
			return null;
		}

		const col = Math.floor(x / this.cellDimensions.width);
		const row =
			Math.floor(y / this.cellDimensions.height) +
			this.terminal.buffer.active.viewportY;

		return {
			col: Math.max(0, Math.min(col, this.terminal.cols - 1)),
			row: Math.max(0, row),
		};
	}

	terminalCoordsToPixels(coords) {
		const rect = this.terminal.element.getBoundingClientRect();
		const containerRect = this.container.getBoundingClientRect();

		const x =
			coords.col * this.cellDimensions.width + (rect.left - containerRect.left);
		const y =
			(coords.row - this.terminal.buffer.active.viewportY) *
				this.cellDimensions.height +
			(rect.top - containerRect.top);

		// Check if coordinates are within visible viewport
		const isVisible =
			coords.row >= this.terminal.buffer.active.viewportY &&
			coords.row < this.terminal.buffer.active.viewportY + this.terminal.rows;

		return isVisible ? { x, y } : null;
	}

	updateCellDimensions() {
		if (this.terminal._core && this.terminal._core._renderService) {
			const dimensions = this.terminal._core._renderService.dimensions;
			if (dimensions && dimensions.css && dimensions.css.cell) {
				this.cellDimensions = {
					width: dimensions.css.cell.width,
					height: dimensions.css.cell.height,
				};
			}
		}
	}

	/**
	 * Check if terminal is currently focused
	 */
	isTerminalFocused() {
		try {
			// Check if terminal element has focus
			return (
				document.activeElement === this.terminal.element ||
				this.terminal.element.contains(document.activeElement) ||
				(this.terminal._core && this.terminal._core._hasFocus)
			);
		} catch (error) {
			return false;
		}
	}

	/**
	 * Get word boundaries at the given coordinates
	 */
	getWordBoundsAt(coords) {
		try {
			const buffer = this.terminal.buffer.active;
			const line = buffer.getLine(coords.row);
			if (!line) return null;

			const lineText = line.translateToString(false);
			if (!lineText || coords.col >= lineText.length) return null;

			const char = lineText[coords.col];
			if (!this.isWordCharacter(char)) return null;

			// Find word start
			let startCol = coords.col;
			while (startCol > 0 && this.isWordCharacter(lineText[startCol - 1])) {
				startCol--;
			}

			// Find word end
			let endCol = coords.col;
			while (
				endCol < lineText.length - 1 &&
				this.isWordCharacter(lineText[endCol + 1])
			) {
				endCol++;
			}

			// Only auto-select if we found a meaningful word (more than just one character)
			if (endCol > startCol) {
				return {
					start: { row: coords.row, col: startCol },
					end: { row: coords.row, col: endCol },
				};
			}

			return null;
		} catch (error) {
			console.warn("Error finding word bounds:", error);
			return null;
		}
	}

	/**
	 * Check if a character is part of a word
	 */
	isWordCharacter(char) {
		if (!char) return false;
		// Word characters: letters, numbers, underscore, hyphen, dot
		return /[a-zA-Z0-9_\-.]/.test(char);
	}

	/**
	 * Start pinch zoom gesture
	 */
	startPinchZoom(event) {
		if (event.touches.length !== 2) return;

		this.isPinching = true;
		this.initialFontSize = this.terminal.options.fontSize;

		const touch1 = event.touches[0];
		const touch2 = event.touches[1];

		this.pinchStartDistance = this.getDistance(touch1, touch2);
		this.lastPinchDistance = this.pinchStartDistance;

		// Clear any selection timeouts
		if (this.tapHoldTimeout) {
			clearTimeout(this.tapHoldTimeout);
			this.tapHoldTimeout = null;
		}
	}

	/**
	 * Handle pinch zoom gesture
	 */
	handlePinchZoom(event) {
		if (!this.isPinching || event.touches.length !== 2) return;

		const now = Date.now();
		if (now - this.lastZoomTime < this.zoomThrottle) return;
		this.lastZoomTime = now;

		const touch1 = event.touches[0];
		const touch2 = event.touches[1];
		const currentDistance = this.getDistance(touch1, touch2);

		const scale = currentDistance / this.pinchStartDistance;
		const newFontSize = Math.round(this.initialFontSize * scale);

		// Clamp font size between reasonable limits
		const minFontSize = 8;
		const maxFontSize = 24;
		const clampedFontSize = Math.max(
			minFontSize,
			Math.min(maxFontSize, newFontSize),
		);

		if (clampedFontSize !== this.terminal.options.fontSize) {
			this.options.onFontSizeChange(clampedFontSize);
		}
	}

	/**
	 * End pinch zoom gesture
	 */
	endPinchZoom() {
		this.isPinching = false;
		this.pinchStartDistance = 0;
		this.lastPinchDistance = 0;
		this.initialFontSize = 0;
	}

	/**
	 * Get distance between two touch points
	 */
	getDistance(touch1, touch2) {
		const dx = touch2.clientX - touch1.clientX;
		const dy = touch2.clientY - touch1.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	/**
	 * Check if touch is likely an Android back gesture (starts near screen edge)
	 */
	isEdgeGesture(touch) {
		const edgeThreshold = 30; // pixels from screen edge
		const screenWidth = window.innerWidth;

		// Check if touch starts near left edge (most common for back gesture)
		if (touch.clientX <= edgeThreshold) {
			return true;
		}

		// Check if touch starts near right edge (for RTL languages or right-handed back gesture)
		if (touch.clientX >= screenWidth - edgeThreshold) {
			return true;
		}

		return false;
	}

	destroy() {
		// Clear selection
		this.forceClearSelection();

		// Remove event listeners
		this.terminal.element.removeEventListener(
			"touchstart",
			this.boundHandlers.terminalTouchStart,
		);
		this.terminal.element.removeEventListener(
			"touchmove",
			this.boundHandlers.terminalTouchMove,
		);
		this.terminal.element.removeEventListener(
			"touchend",
			this.boundHandlers.terminalTouchEnd,
		);

		this.startHandle.removeEventListener(
			"touchstart",
			this.boundHandlers.handleTouchStart,
		);
		this.startHandle.removeEventListener(
			"touchmove",
			this.boundHandlers.handleTouchMove,
		);
		this.startHandle.removeEventListener(
			"touchend",
			this.boundHandlers.handleTouchEnd,
		);

		this.endHandle.removeEventListener(
			"touchstart",
			this.boundHandlers.handleTouchStart,
		);
		this.endHandle.removeEventListener(
			"touchmove",
			this.boundHandlers.handleTouchMove,
		);
		this.endHandle.removeEventListener(
			"touchend",
			this.boundHandlers.handleTouchEnd,
		);

		this.terminal.element.removeEventListener(
			"touchstart",
			this.boundHandlers.terminalAreaTouchStart,
		);
		this.terminal.element.removeEventListener(
			"scroll",
			this.boundHandlers.terminalScroll,
		);
		window.removeEventListener(
			"orientationchange",
			this.boundHandlers.orientationChange,
		);
		window.removeEventListener("resize", this.boundHandlers.orientationChange);

		// Remove selection change listener
		if (this.terminal.onSelectionChange) {
			this.terminal.onSelectionChange(null);
		}

		// Remove DOM elements
		if (this.selectionOverlay && this.selectionOverlay.parentNode) {
			this.selectionOverlay.parentNode.removeChild(this.selectionOverlay);
		}
	}
}
