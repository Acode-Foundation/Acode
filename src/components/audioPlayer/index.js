import "./style.scss";

export default class AudioPlayer {
	constructor(container) {
		this.container = container;
		this.audio = new Audio();
		this.isPlaying = false;
		this.initializeUI();
		this.initializeEvents();
		this.cleanup = this.cleanup.bind(this);
	}

	initializeUI() {
		const auidoPlayer = (
			<div className="audio-player">
				<button className="play-btn" ariaLabel="Play/Pause">
					<span className="icon play_arrow"></span>
				</button>

				<div className="timeline">
					<div className="progress"></div>
					<div className="progress-handle"></div>
				</div>

				<div className="time">0:00</div>

				<div className="volume-control">
					<button className="volume-btn" ariaLabel="Volume"></button>
				</div>
			</div>
		);

		this.container.appendChild(auidoPlayer);

		this.elements = {
			playBtn: this.container.querySelector(".play-btn"),
			playIcon: this.container.querySelector(".play-btn .icon"),
			timeline: this.container.querySelector(".timeline"),
			progress: this.container.querySelector(".progress"),
			progressHandle: this.container.querySelector(".progress-handle"),
			timeDisplay: this.container.querySelector(".time"),
			duration: this.container.querySelector(".duration"),
			volumeBtn: this.container.querySelector(".volume-btn"),
		};
		this.elements.volumeBtn.innerHTML = `<svg viewBox="0 0 24 24">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
      </svg>`;
	}

	initializeEvents() {
		// Play/Pause
		this.elements.playBtn.addEventListener("click", () => this.togglePlay());

		// Timeline
		this.elements.timeline.addEventListener("click", (e) => this.seek(e));
		this.elements.timeline.addEventListener("touchstart", (e) => this.seek(e));

		// Volume
		this.elements.volumeBtn.addEventListener("click", () => this.toggleMute());

		// Audio events
		this.audio.addEventListener("timeupdate", () => this.updateProgress());
		this.audio.addEventListener("ended", () => this.audioEnded());
	}

	togglePlay() {
		if (this.isPlaying) {
			this.audio.pause();
			this.elements.playIcon.classList.remove("pause");
			this.elements.playIcon.classList.add("play_arrow");
		} else {
			this.audio.play();
			this.elements.playIcon.classList.remove("play_arrow");
			this.elements.playIcon.classList.add("pause");
		}
		this.isPlaying = !this.isPlaying;
	}

	seek(e) {
		const rect = this.elements.timeline.getBoundingClientRect();
		const pos =
			(e.type.includes("touch") ? e.touches[0].clientX : e.clientX) - rect.left;
		const percentage = pos / rect.width;
		this.audio.currentTime = percentage * this.audio.duration;
	}

	updateProgress() {
		const percentage = (this.audio.currentTime / this.audio.duration) * 100;
		this.elements.progress.style.width = `${percentage}%`;
		this.elements.progressHandle.style.left = `${percentage}%`;
		this.elements.timeDisplay.textContent = this.formatTime(
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
			this.elements.volumeBtn.innerHTML =
				'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/></svg>';
		} else {
			this.elements.volumeBtn.innerHTML =
				'<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
		}
	}

	audioEnded() {
		this.isPlaying = false;
		this.elements.playIcon.classList.remove("pause");
		this.elements.playIcon.classList.add("play_arrow");
	}

	loadTrack(src) {
		this.audio.src = src;
		this.audio.load();
	}

	cleanup() {
		this.audio.pause();
		this.audio.currentTime = 0;
		this.isPlaying = false;

		this.elements.playBtn.removeEventListener("click", () => this.togglePlay());
		this.elements.timeline.removeEventListener("click", (e) => this.seek(e));
		this.elements.timeline.removeEventListener("touchstart", (e) =>
			this.seek(e),
		);
		this.elements.volumeBtn.removeEventListener("click", () =>
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
