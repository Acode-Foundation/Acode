import "./style.scss";
import Ref from "html-tag-js/ref";

export default class AudioPlayer {
	constructor(container) {
		this.container = container;
		this.audio = new Audio();
		this.isPlaying = false;
		this.elements = {
			playBtn: Ref(),
			playIcon: Ref(),
			timeline: Ref(),
			progress: Ref(),
			progressHandle: Ref(),
			timeDisplay: Ref(),
			duration: Ref(),
			volumeBtn: Ref(),
		};
		this.initializeUI();
		this.initializeEvents();
		this.cleanup = this.cleanup.bind(this);
	}

	initializeUI() {
		const audioPlayer = (
			<div className="audio-player">
				<button
					ref={this.elements.playBtn}
					className="play-btn"
					ariaLabel="Play/Pause"
				>
					<span ref={this.elements.playIcon} className="icon play_arrow"></span>
				</button>

				<div ref={this.elements.timeline} className="timeline">
					<div ref={this.elements.progress} className="progress"></div>
					<div
						ref={this.elements.progressHandle}
						className="progress-handle"
					></div>
				</div>

				<div ref={this.elements.timeDisplay} className="time">
					0:00
				</div>

				<div className="volume-control">
					<button
						ref={this.elements.volumeBtn}
						className="volume-btn"
						ariaLabel="Volume"
					></button>
				</div>
			</div>
		);

		this.container.appendChild(audioPlayer);

		this.elements.volumeBtn.el.innerHTML = `<svg viewBox="0 0 24 24">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
    </svg>`;
	}

	initializeEvents() {
		// Play/Pause
		this.elements.playBtn.el.addEventListener("click", () => this.togglePlay());

		// Timeline
		this.elements.timeline.el.addEventListener("click", (e) => this.seek(e));
		this.elements.timeline.el.addEventListener("touchstart", (e) =>
			this.seek(e),
		);

		// Volume
		this.elements.volumeBtn.el.addEventListener("click", () =>
			this.toggleMute(),
		);

		// Audio events
		this.audio.addEventListener("timeupdate", () => this.updateProgress());
		this.audio.addEventListener("ended", () => this.audioEnded());
	}

	togglePlay() {
		if (this.isPlaying) {
			this.audio.pause();
			this.elements.playIcon.el.classList.remove("pause");
			this.elements.playIcon.el.classList.add("play_arrow");
		} else {
			this.audio.play();
			this.elements.playIcon.el.classList.remove("play_arrow");
			this.elements.playIcon.el.classList.add("pause");
		}
		this.isPlaying = !this.isPlaying;
	}

	seek(e) {
		const rect = this.elements.timeline.el.getBoundingClientRect();
		const pos =
			(e.type.includes("touch") ? e.touches[0].clientX : e.clientX) - rect.left;
		const percentage = pos / rect.width;
		this.audio.currentTime = percentage * this.audio.duration;
	}

	updateProgress() {
		const percentage = (this.audio.currentTime / this.audio.duration) * 100;
		this.elements.progress.el.style.width = `${percentage}%`;
		this.elements.progressHandle.el.style.left = `${percentage}%`;
		this.elements.timeDisplay.el.textContent = this.formatTime(
			this.audio.currentTime,
		);
	}

	formatTime(seconds) {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}

	toggleMute() {
		this.audio.muted = !this.audio.muted;
		if (this.audio.muted) {
			this.elements.volumeBtn.el.innerHTML =
				'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/></svg>';
		} else {
			this.elements.volumeBtn.el.innerHTML =
				'<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
		}
	}

	audioEnded() {
		this.isPlaying = false;
		this.elements.playIcon.el.classList.remove("pause");
		this.elements.playIcon.el.classList.add("play_arrow");
	}

	loadTrack(src) {
		this.audio.src = src;
		this.audio.load();
	}

	cleanup() {
		this.audio.pause();
		this.audio.currentTime = 0;
		this.isPlaying = false;

		this.elements.playBtn.el.removeEventListener("click", () =>
			this.togglePlay(),
		);
		this.elements.timeline.el.removeEventListener("click", (e) => this.seek(e));
		this.elements.timeline.el.removeEventListener("touchstart", (e) =>
			this.seek(e),
		);
		this.elements.volumeBtn.el.removeEventListener("click", () =>
			this.toggleMute(),
		);
		this.audio.removeEventListener("timeupdate", () => this.updateProgress());
		this.audio.removeEventListener("ended", () => this.audioEnded());

		const audioSrc = this.audio.src;
		this.audio.src = "";
		this.audio.load();
		if (audioSrc.startsWith("blob:")) {
			URL.revokeObjectURL(audioSrc);
		}
	}
}
