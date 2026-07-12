/**
 * Terminal Touch Scrolling with Momentum Physics
 * Provides smooth, consistent touch scrolling with inertia across all Android WebView versions.
 *
 * Listens on terminal.element (same as TerminalTouchSelection) because renderer
 * layers intercept touch events. Pixel movement is converted to terminal rows and
 * sent through xterm's public scroll API so it works with the v6 custom scrollbar.
 */

export default class TerminalTouchScrolling {
	#tryAttempts = 0;
	#destroyed = false;

	constructor(terminal, touchSelection = null) {
		this.terminal = terminal;
		this.touchSelection = touchSelection;
		this.element = null;

		this.touchStartY = 0;
		this.lastTouchY = 0;
		this.lastTouchTime = 0;
		this.isTouching = false;
		this.didScroll = false;

		this.velocitySamples = [];
		this.velocity = 0;
		this.scrollRemainder = 0;
		this.maxVelocity = 35;
		this.friction = 0.95;
		this.minVelocity = 0.1;
		this.velocityThreshold = 1;

		this.animationId = null;
		this.boundHandlers = {};

		this.#tryInit();
	}

	#tryInit() {
		if (this.#destroyed) return;
		this.element = this.terminal?.element || null;
		if (!this.element) {
			this.#tryAttempts++;
			if (this.#tryAttempts < 10) {
				requestAnimationFrame(() => this.#tryInit());
			}
			return;
		}
		this.attachListeners();
	}

	getCellHeight() {
		const screen = this.element?.querySelector(".xterm-screen");
		const screenHeight = screen?.getBoundingClientRect().height || 0;
		return screenHeight > 0 && this.terminal.rows > 0
			? screenHeight / this.terminal.rows
			: this.terminal.options.fontSize *
					(this.terminal.options.lineHeight || 1);
	}

	scrollByPixels(deltaY) {
		const cellHeight = this.getCellHeight();
		if (!Number.isFinite(cellHeight) || cellHeight <= 0) return;

		this.scrollRemainder += deltaY;
		const lines = Math.trunc(this.scrollRemainder / cellHeight);
		if (lines === 0) return;

		this.terminal.scrollLines(lines);
		this.scrollRemainder -= lines * cellHeight;
	}

	attachListeners() {
		if (!this.element) return;

		this.boundHandlers.touchStart = this.onTouchStart.bind(this);
		this.boundHandlers.touchMove = this.onTouchMove.bind(this);
		this.boundHandlers.touchEnd = this.onTouchEnd.bind(this);
		this.boundHandlers.touchCancel = this.onTouchEnd.bind(this);

		this.element.addEventListener("touchstart", this.boundHandlers.touchStart, {
			passive: false,
		});
		this.element.addEventListener("touchmove", this.boundHandlers.touchMove, {
			passive: false,
		});
		this.element.addEventListener("touchend", this.boundHandlers.touchEnd, {
			passive: false,
		});
		this.element.addEventListener(
			"touchcancel",
			this.boundHandlers.touchCancel,
		);
	}

	isSelectionActive() {
		if (!this.touchSelection) return false;
		return (
			this.touchSelection.isHandleDragging ||
			this.touchSelection.isPinching ||
			this.touchSelection.isSelectionTouchActive
		);
	}

	onTouchStart(event) {
		if (this.isSelectionActive()) return;
		if (event.touches.length !== 1) return;

		this.stopMomentum();

		const touch = event.touches[0];
		this.touchStartY = touch.clientY;
		this.lastTouchY = touch.clientY;
		this.lastTouchTime = performance.now();
		this.isTouching = true;
		this.didScroll = false;
		this.velocity = 0;
		this.velocitySamples = [];
		this.scrollRemainder = 0;
	}

	onTouchMove(event) {
		if (!this.isTouching) return;

		if (this.isSelectionActive()) {
			this.isTouching = false;
			return;
		}

		if (event.touches.length !== 1) {
			this.isTouching = false;
			return;
		}

		const touch = event.touches[0];
		const deltaY = this.lastTouchY - touch.clientY;
		const deltaTime = performance.now() - this.lastTouchTime;

		if (deltaTime > 0) {
			const instantVelocity = (deltaY / deltaTime) * 16.67;
			this.velocitySamples.push(instantVelocity);
			if (this.velocitySamples.length > 6) {
				this.velocitySamples.shift();
			}
		}

		if (Math.abs(deltaY) > 0.5) {
			event.preventDefault();
			this.didScroll = true;

			this.scrollByPixels(deltaY);
		}

		this.lastTouchY = touch.clientY;
		this.lastTouchTime = performance.now();
	}

	onTouchEnd(event) {
		if (!this.isTouching) return;

		if (this.didScroll && event.cancelable) {
			event.preventDefault();
		}

		this.isTouching = false;

		if (!this.didScroll) {
			this.velocitySamples = [];
			return;
		}

		if (this.velocitySamples.length > 0) {
			this.velocity =
				this.velocitySamples.reduce((a, b) => a + b, 0) /
				this.velocitySamples.length;

			this.velocity = Math.max(
				-this.maxVelocity,
				Math.min(this.maxVelocity, this.velocity),
			);
		}

		if (Math.abs(this.velocity) > this.velocityThreshold) {
			this.startMomentum();
		}

		this.velocitySamples = [];
	}

	startMomentum() {
		const animate = () => {
			if (this.isTouching) {
				this.animationId = null;
				return;
			}

			if (Math.abs(this.velocity) < this.minVelocity) {
				this.stopMomentum();
				return;
			}

			this.scrollByPixels(this.velocity);
			this.velocity *= this.friction;

			this.animationId = requestAnimationFrame(animate);
		};

		this.animationId = requestAnimationFrame(animate);
	}

	stopMomentum() {
		if (this.animationId) {
			cancelAnimationFrame(this.animationId);
			this.animationId = null;
		}
		this.velocity = 0;
	}

	destroy() {
		this.#destroyed = true;
		this.stopMomentum();

		if (this.element) {
			this.element.removeEventListener(
				"touchstart",
				this.boundHandlers.touchStart,
			);
			this.element.removeEventListener(
				"touchmove",
				this.boundHandlers.touchMove,
			);
			this.element.removeEventListener("touchend", this.boundHandlers.touchEnd);
			this.element.removeEventListener(
				"touchcancel",
				this.boundHandlers.touchCancel,
			);
			this.element = null;
		}

		this.terminal = null;
		this.touchSelection = null;
	}
}
