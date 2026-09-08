import fsOperation from "fileSystem";
import TabView from "components/tabView";
import toast from "components/toast";
import dayjs from "dayjs/esm";
import dayjsRelativeTime from "dayjs/esm/plugin/relativeTime";
import dayjsUpdateLocale from "dayjs/esm/plugin/updateLocale";
import dayjsUtc from "dayjs/esm/plugin/utc";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import DOMPurify from "dompurify";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import auth, { loginEvents } from "lib/auth";
import config from "lib/config";
import { getIntlLocale, getLocaleDirection } from "lib/lang";
import settings from "lib/settings";
import helpers from "utils/helpers";
import Url from "utils/Url";
import {
	formatReviewDate,
	getRatingClass,
	getRatingLabel,
	hasReviewChanged,
	partitionPluginReviews,
	REVIEW_MAX_COMMENT_LENGTH,
	resolveReviewAvatarUrl,
	updateReviewStats,
	validateReviewDraft,
} from "./reviewUtils";

dayjs.extend(dayjsRelativeTime);
dayjs.extend(dayjsUtc);
dayjs.extend(dayjsUpdateLocale);

// Configure dayjs for shorter relative time format
dayjs.updateLocale("en", {
	relativeTime: {
		future: "in %s",
		past: (value, withoutSuffix) => {
			if (value === "now") {
				return value;
			}
			return withoutSuffix ? value : `${value} ago`;
		},
		s: "now",
		ss: "now",
		m: "1m",
		mm: "%dm",
		h: "1h",
		hh: "%dh",
		d: "1d",
		dd: "%dd",
		M: "1mo",
		MM: "%dmo",
		y: "1y",
		yy: "%dy",
	},
});

export const cleanups = [];

export default (props) => {
	const {
		id,
		name,
		body,
		icon,
		author,
		downloads,
		license,
		changelogs,
		repository,
		keywords: keywordsRaw,
		contributors: contributorsRaw,
		votes_up: votesUp,
		votes_down: votesDown,
		author_verified: authorVerified,
		author_github: authorGithub,
		comment_count: commentCount,
		package_updated_at: packageUpdatedAt,
		showEditorSupportWarning,
		unsupportedEditor,
	} = props;

	let reviewStats = {
		votesUp: Number(votesUp) || 0,
		votesDown: Number(votesDown) || 0,
		commentCount: Number(commentCount) || 0,
	};
	let rating = getRatingLabel(reviewStats.votesUp, reviewStats.votesDown);
	const getRatingText = () =>
		rating === "unrated" ? strings["plugin-review:unrated"] : rating;
	const ratingValueRef = Ref();
	const commentCountRef = Ref();

	const keywords =
		typeof keywordsRaw === "string" ? JSON.parse(keywordsRaw) : keywordsRaw;
	const contributors =
		typeof contributorsRaw === "string"
			? JSON.parse(contributorsRaw)
			: contributorsRaw;

	const showPurchaseWarning = !helpers.shouldAllowExternalPurchase();
	const applyReviewStats = (nextStats) => {
		reviewStats = nextStats;
		rating = getRatingLabel(reviewStats.votesUp, reviewStats.votesDown);
		ratingValueRef.textContent = getRatingText();
		ratingValueRef.className = getRatingClass(rating);
		commentCountRef.textContent = reviewStats.commentCount;
	};

	const formatUpdatedDate = (dateString) => {
		if (!dateString) return null;

		try {
			const updateTime = dayjs.utc(dateString);
			if (!updateTime.isValid()) return null;

			return updateTime.fromNow();
		} catch (error) {
			console.warn("Error parsing date with dayjs:", dateString, error);
			return null;
		}
	};

	return (
		<div className="main" id="plugin">
			<div className="plugin-header">
				<div
					className="plugin-icon"
					style={{ backgroundImage: `url(${icon})` }}
				></div>
				<div className="plugin-info">
					<div className="title-wrapper">
						<h1 className="plugin-name">{name}</h1>
						{repository ? (
							<a href={repository} className="source-indicator">
								<i className="icon github"></i>
								<span>{strings.open_source}</span>
							</a>
						) : null}
					</div>
					<div className="plugin-meta">
						<span className="meta-item">
							<i className="icon tag" style={{ fontSize: "12px" }}></i>
							<Version
								{...props}
								packageUpdatedAt={packageUpdatedAt}
								formatUpdatedDate={formatUpdatedDate}
							/>
						</span>
						<span className="meta-item author-name">
							<i className="icon person"></i>
							<a href={`https://github.com/${authorGithub}`} className="">
								{author}
							</a>
							{authorVerified ? (
								<i
									on:click={() => {
										toast(strings["verified publisher"]);
									}}
									className="icon verified verified-tick"
								></i>
							) : (
								""
							)}
						</span>
						<span className="meta-item">
							<span className="icon scale" style={{ fontSize: "12px" }}></span>
							{license || "Unknown"}
						</span>
					</div>
					{votesUp !== undefined ? (
						<div className="metrics-row">
							<div className="metric">
								<span className="icon save_alt"></span>
								<span className="metric-value">
									{helpers.formatDownloadCount(
										typeof downloads === "string"
											? Number.parseInt(downloads)
											: downloads,
									)}
								</span>
								<span>{strings.downloads}</span>
							</div>
							<div className="metric">
								<i className="icon like-solid"></i>
								<span ref={ratingValueRef} className={getRatingClass(rating)}>
									{getRatingText()}
								</span>
							</div>
							<div
								className="metric"
								onclick={() =>
									showReviews({
										pluginId: id,
										author,
										stats: reviewStats,
										onStatsChange: applyReviewStats,
									})
								}
							>
								<i className="icon chat_bubble"></i>
								<span ref={commentCountRef} className="metric-value">
									{reviewStats.commentCount}
								</span>
								<span>{strings.reviews}</span>
							</div>
						</div>
					) : null}
					{Array.isArray(keywords) && keywords.length ? (
						<div className="keywords">
							{keywords.map((keyword) => (
								<span className="keyword" title={keyword}>
									{keyword}
								</span>
							))}
						</div>
					) : null}
					{showEditorSupportWarning ? (
						<LegacyEditorWarning unsupportedEditor={unsupportedEditor} />
					) : null}
				</div>
				<div className="action-buttons">
					<Buttons {...props} />
				</div>
				{showPurchaseWarning || props.purchased ? (
					<div className="plugin-action-details">
						{showPurchaseWarning ? (
							<small className="info">
								<span className="icon info" />
								{strings["iap-plugin-purchase-warning"]}
							</small>
						) : null}
						<MoreInfo {...props} />
					</div>
				) : null}
			</div>
			<TabView id="plugin-tab" disableSwipe={true}>
				<div className="options" onclick={handleTabClick}>
					<span className="tab active" data-tab="overview" tabindex="0">
						{strings.overview}
					</span>
					<span className="tab" data-tab="contributors" tabindex="0">
						{strings.contributors}
					</span>
					<span className="tab" data-tab="changelog" tabindex="0">
						{strings.changelog}
					</span>
				</div>
				<div className="tab-content">
					<div id="overview" className="content-section active md">
						<section
							innerHTML={DOMPurify.sanitize(body, { FORBID_TAGS: ["style"] })}
						/>
					</div>
					<div id="contributors" className="content-section">
						{(() => {
							let contributorsList = contributors?.length
								? [
										{ name: author, role: "Developer", github: authorGithub },
										...contributors,
									]
								: [{ name: author, role: "Developer", github: authorGithub }];

							return contributorsList.map(({ name, role, github }) => {
								let dp = Url.join(config.API_BASE, `../user.png`);
								if (github) {
									dp = `https://avatars.githubusercontent.com/${github}`;
								}
								return (
									<a
										className="contributor"
										href={`https://github.com/${github}`}
										style={{ textDecoration: "none" }}
									>
										<img src={dp} alt={name} />
										<div className="contributor-info">
											<div className="contributor-name">{name}</div>
											<div className="contributor-role">{role}</div>
										</div>
									</a>
								);
							});
						})()}
					</div>

					<div
						id="changelog"
						className="content-section md"
						innerHTML={
							DOMPurify.sanitize(changelogs, { FORBID_TAGS: ["style"] }) ||
							`
							<div class="no-changelog">
								<i class="icon historyrestore"></i>
								<p style="font-size: 1.1rem;">
									No changelog is available for this plugin yet.
								</p>
								<p style="font-size: 0.9rem; font-style: italic;">
									Check back later for updates!
								</p>
							</div>
					`
						}
					></div>
				</div>
			</TabView>
		</div>
	);
};

function handleTabClick(e) {
	const $target = e.target;
	if (!$target.classList.contains("tab")) return;

	const tabs = document.querySelectorAll(".tab");
	const contents = document.querySelectorAll(".content-section");

	tabs.forEach((tab) => tab.classList.remove("active"));
	contents.forEach((content) => content.classList.remove("active"));

	$target.classList.add("active");
	const tabId = $target.dataset.tab;
	document.getElementById(tabId).classList.add("active");
}

async function Buttons(props) {
	const {
		id,
		name,
		isPaid,
		installed,
		update,
		install,
		uninstall,
		purchased,
		price,
		buy,
		minVersionCode,
	} = props;

	if (
		typeof minVersionCode === "number" &&
		minVersionCode > BuildInfo.versionCode
	) {
		return (
			<div className="error">
				<span className="icon info"></span>
				<a href={config.PLAY_STORE_URL} className="text">
					{strings["plugin min version"]
						.replace("{name}", name)
						.replace("{v-code}", minVersionCode)}
				</a>
			</div>
		);
	}

	if (installed && update) {
		return (
			<>
				<button
					data-type="uninstall"
					onclick={uninstall}
					className="btn btn-uninstall"
				>
					<i className="icon delete_outline"></i>
					{strings.uninstall}
				</button>
				<button data-type="update" className="btn btn-update" onclick={install}>
					<i className="icon update"></i>
					{strings.update}
				</button>
			</>
		);
	}

	if (installed) {
		return (
			<button
				data-type="uninstall"
				className="btn btn-uninstall"
				onclick={uninstall}
			>
				<i className="icon delete_outline"></i>
				{strings.uninstall}
			</button>
		);
	}

	const user = await auth.getLoggedInUser();
	if (isPaid && helpers.shouldAllowExternalPurchase() && !user) {
		const buttonRef = Ref();
		return (
			<button
				ref={buttonRef}
				data-type="info"
				className="btn btn-install"
				onclick={async () => {
					try {
						await auth.login();
						const newButton = await Buttons(props);
						buttonRef.el.replaceWith(newButton);
					} catch (error) {
						helpers.error(error);
					}
				}}
			>
				<i className="icon user-round"></i>
				{strings.login}
			</button>
		);
	}

	if (isPaid && !purchased && price) {
		return (
			<button data-type="buy" className="btn btn-install" onclick={buy}>
				<i className="icon cart"></i>
				{price}
			</button>
		);
	}

	if (isPaid && !purchased && !price) {
		return (
			<div style={{ margin: "auto" }} className="flex-center">
				<span
					onclick={() => alert(strings.info, strings["no-product-info"])}
					className="icon info"
				></span>
				<span>{strings["product not available"]}</span>
			</div>
		);
	}

	return (
		<button data-type="install" className="btn btn-install" onclick={install}>
			<i className="icon save_alt"></i>
			{strings.install}
		</button>
	);
}

function LegacyEditorWarning({ unsupportedEditor }) {
	const oldEditor =
		unsupportedEditor === "ace" ? "Ace" : unsupportedEditor || "the old editor";
	return (
		<div className="legacy-editor-warning">
			<span className="icon info"></span>
			<span>
				{`Built for older Acode versions powered by ${oldEditor}. Install with caution; some features may behave unexpectedly in the current CodeMirror version.`}
			</span>
		</div>
	);
}

function Version({
	currentVersion,
	version,
	packageUpdatedAt,
	formatUpdatedDate,
}) {
	const updatedText =
		formatUpdatedDate && packageUpdatedAt
			? formatUpdatedDate(packageUpdatedAt)
			: null;

	if (!currentVersion) {
		return (
			<span>
				v{version}
				{updatedText && (
					<span className="version-updated">({updatedText})</span>
				)}
			</span>
		);
	}

	return (
		<span>
			v{currentVersion}&nbsp;&#8594;&nbsp;v{version}
			{updatedText && <span className="version-updated">({updatedText})</span>}
		</span>
	);
}

async function showReviews({ pluginId, author, stats, onStatsChange }) {
	const locale = getIntlLocale(settings.value?.lang);
	const mask = Ref();
	const body = Ref();
	const composer = Ref();
	const container = Ref();
	const state = {
		busy: false,
		closed: false,
		draftComment: "",
		draftDirty: false,
		draftVote: 0,
		editorError: "",
		expanded: false,
		reviewListError: null,
		reviews: [],
		resumeDraftAfterSignIn: false,
		stats: { ...stats },
		user: null,
		userReview: null,
	};
	let removeDragListeners = () => {};

	actionStack.push({
		id: "reviews",
		action: closeReviews,
	});

	app.append(
		<span
			style={{ zIndex: 998 }}
			ref={mask}
			onclick={closeReviews}
			className="mask"
		></span>,
	);
	app.append(
		<div
			ref={container}
			className="reviews-container"
			role="dialog"
			aria-modal="true"
			aria-label={strings["plugin-review:dialog-label"]}
			dir={getLocaleDirection(locale)}
		>
			<div className="reviews-header" ontouchstart={ontouchstart}>
				<span className="reviews-drag-handle"></span>
				<strong>{strings.reviews}</strong>
				<button
					type="button"
					className="reviews-close icon clearclose"
					aria-label={strings.close}
					title={strings.close}
					onclick={closeReviews}
				></button>
			</div>
			<div ref={composer} className="review-composer loading"></div>
			<div ref={body} className="reviews-body loading"></div>
		</div>,
	);

	await initialize();

	async function initialize() {
		composer.el.classList.add("loading");
		body.el.classList.add("loading");
		state.reviewListError = null;

		const [reviewsResult, userResult] = await Promise.allSettled([
			loadReviews(),
			auth.getLoggedInUser(),
		]);
		if (state.closed) return;

		if (reviewsResult.status === "fulfilled") {
			state.reviews = reviewsResult.value;
		} else {
			state.reviewListError = reviewsResult.reason;
		}

		if (userResult.status === "fulfilled") {
			state.user = userResult.value;
			if (state.user) {
				const { ownReview: listedReview } = partitionPluginReviews(
					state.reviews,
					null,
					state.user.id,
				);
				try {
					state.userReview = (await loadUserReview()) || listedReview || null;
				} catch {
					state.userReview = listedReview || null;
				}
			}
		} else {
			state.editorError = strings["plugin-review:account-check-failed"];
		}

		composer.el.classList.remove("loading");
		body.el.classList.remove("loading");
		renderComposer();
		renderReviews();
	}

	function renderComposer({ focus = false } = {}) {
		if (state.closed) return;
		composer.el.classList.remove("loading");
		composer.el.classList.remove("review-composer-hidden");

		if (!state.user) {
			const errorMessage = state.editorError;
			composer.el.replaceChildren(
				<div className="review-sign-in review-entry-surface">
					<span
						className="review-avatar icon user-round"
						aria-hidden="true"
					></span>
					<div className="review-sign-in-content">
						<button
							type="button"
							className="review-add-button"
							disabled={state.busy}
							onclick={signIn}
						>
							{state.busy
								? strings["loading..."]
								: strings["plugin-review:sign-in"]}
						</button>
						{errorMessage ? (
							<small className="review-error">{errorMessage}</small>
						) : null}
					</div>
				</div>,
			);
			return;
		}

		if (!state.expanded && state.userReview) {
			composer.el.replaceChildren();
			composer.el.classList.add("review-composer-hidden");
			return;
		}

		if (!state.expanded) {
			composer.el.replaceChildren(
				<div className="review-add-row review-entry-surface">
					<ReviewAvatar user={state.user} />
					<button
						type="button"
						className="review-add-button"
						onclick={openEditor}
					>
						{state.userReview
							? strings["plugin-review:edit"]
							: strings["plugin-review:add"]}
					</button>
				</div>,
			);
			return;
		}

		const textarea = Ref();
		const counter = Ref();
		const error = Ref();
		const saveButton = Ref();
		const upButton = Ref();
		const upIcon = Ref();
		const downButton = Ref();
		const downIcon = Ref();

		composer.el.replaceChildren(
			<div className="review-editor review-entry-surface">
				<div className="review-editor-main">
					<ReviewAvatar user={state.user} />
					<div className="review-editor-fields">
						<textarea
							ref={textarea}
							rows="1"
							maxlength={REVIEW_MAX_COMMENT_LENGTH}
							placeholder={strings["plugin-review:placeholder"]}
							aria-label={strings["plugin-review:input-label"]}
							oninput={(event) => {
								state.draftComment = event.target.value;
								state.draftDirty = true;
								state.editorError = "";
								autosizeReviewInput(event.target);
								updateEditorState();
							}}
						>
							{state.draftComment}
						</textarea>
						<div className="review-editor-meta">
							<small ref={error} className="review-error"></small>
							<small ref={counter} className="review-counter"></small>
						</div>
					</div>
				</div>
				<div className="review-editor-actions">
					<div
						className="review-vote-actions"
						role="group"
						aria-label={strings["plugin-review:vote-group-label"]}
					>
						<button
							ref={upButton}
							type="button"
							className="review-vote-button"
							aria-label={strings["plugin-review:thumbs-up"]}
							onclick={() => toggleVote(1)}
						>
							<span ref={upIcon} className="icon like"></span>
						</button>
						<button
							ref={downButton}
							type="button"
							className="review-vote-button review-vote-down"
							aria-label={strings["plugin-review:thumbs-down"]}
							onclick={() => toggleVote(-1)}
						>
							<span ref={downIcon} className="icon like"></span>
						</button>
					</div>
					<div className="review-form-actions">
						{state.userReview ? (
							<button
								type="button"
								className="review-delete-button icon delete_outline"
								aria-label={strings["plugin-review:delete"]}
								title={strings["plugin-review:delete"]}
								disabled={state.busy}
								onclick={deleteReview}
							></button>
						) : null}
						<button
							type="button"
							className="review-cancel-button"
							disabled={state.busy}
							onclick={cancelEditor}
						>
							{strings.cancel}
						</button>
						<button
							ref={saveButton}
							type="button"
							className="review-save-button"
							onclick={saveReview}
						>
							{state.userReview ? strings.update : strings.save}
						</button>
					</div>
				</div>
			</div>,
		);

		textarea.el.value = state.draftComment;
		autosizeReviewInput(textarea.el);
		updateEditorState();
		if (focus) requestAnimationFrame(() => textarea.el.focus());

		function toggleVote(vote) {
			state.draftVote = state.draftVote === vote ? 0 : vote;
			state.draftDirty = true;
			state.editorError = "";
			updateEditorState();
		}

		function updateEditorState() {
			const validation = validateReviewDraft({
				comment: state.draftComment,
				vote: state.draftVote,
			});
			const unchanged = !hasReviewChanged(state.userReview, validation);
			const validationMessage =
				state.draftDirty && validation.errorKey
					? getReviewString(validation.errorKey, {
							max: REVIEW_MAX_COMMENT_LENGTH,
						})
					: "";

			counter.textContent = `${state.draftComment.length}/${REVIEW_MAX_COMMENT_LENGTH}`;
			error.textContent = state.editorError || validationMessage;
			upButton.el.classList.toggle("selected", state.draftVote === 1);
			downButton.el.classList.toggle("selected", state.draftVote === -1);
			upButton.el.setAttribute("aria-pressed", state.draftVote === 1);
			downButton.el.setAttribute("aria-pressed", state.draftVote === -1);
			upIcon.className = `icon ${state.draftVote === 1 ? "like-solid" : "like"}`;
			downIcon.className = `icon ${state.draftVote === -1 ? "like-solid" : "like"}`;
			saveButton.disabled = Boolean(
				validation.errorKey || unchanged || state.busy,
			);
			saveButton.textContent = state.busy
				? strings["loading..."]
				: state.userReview
					? strings.update
					: strings.save;
		}
	}

	function renderReviews() {
		if (state.closed) return;
		body.el.classList.remove("loading");

		if (state.reviewListError) {
			body.el.replaceChildren(
				<div className="reviews-state">
					<span>{strings["plugin-review:load-failed"]}</span>
					<button type="button" onclick={retryReviews}>
						{strings["plugin-review:retry"]}
					</button>
				</div>,
			);
			return;
		}

		const { ownReview, communityReviews } = partitionPluginReviews(
			state.reviews,
			state.userReview,
			state.user?.id,
		);
		const showOwnReview = Boolean(ownReview && !state.expanded);

		if (!showOwnReview && !communityReviews.length && !state.expanded) {
			body.el.replaceChildren(
				<div className="reviews-state reviews-empty">
					<span className="icon chat_bubble"></span>
					<strong>{strings["plugin-review:empty-title"]}</strong>
					<small>{strings["plugin-review:empty-description"]}</small>
				</div>,
			);
			return;
		}

		const sections = [];
		if (showOwnReview) {
			sections.push(
				<section className="reviews-section own-review-section">
					<div className="reviews-section-label">
						{strings["plugin-review:yours"]}
					</div>
					<div className="reviews-card own-review-card">
						<Review
							{...ownReview}
							name={ownReview.name || state.user?.name}
							github={ownReview.github || state.user?.github}
							avatar_url={ownReview.avatar_url || state.user?.avatar_url}
							author={author}
							isOwn={true}
							onEdit={openEditor}
							locale={locale}
						/>
					</div>
				</section>,
			);
		}

		sections.push(
			<section className="reviews-section community-reviews-section">
				<div className="reviews-section-label">
					{strings["plugin-review:community"]}
				</div>
				{communityReviews.length ? (
					<div className="reviews-card">
						{communityReviews.map((review) => (
							<Review {...review} author={author} locale={locale} />
						))}
					</div>
				) : (
					<div className="reviews-card reviews-community-empty">
						<small>{strings["plugin-review:no-other-reviews"]}</small>
					</div>
				)}
			</section>,
		);

		body.el.replaceChildren(...sections);
	}

	function openEditor() {
		state.draftComment = state.userReview?.comment || "";
		state.draftVote = state.userReview?.vote || 0;
		state.draftDirty = false;
		state.editorError = "";
		state.expanded = true;
		state.resumeDraftAfterSignIn = false;
		renderComposer({ focus: true });
		renderReviews();
	}

	function cancelEditor() {
		if (state.busy) return;
		state.expanded = false;
		state.editorError = "";
		state.resumeDraftAfterSignIn = false;
		renderComposer();
		renderReviews();
	}

	async function signIn() {
		if (state.busy) return;
		state.busy = true;
		state.editorError = "";
		renderComposer();

		try {
			await auth.login();
			const user = await auth.getLoggedInUser(true);
			if (!user) {
				state.busy = false;
				state.editorError = strings["plugin-review:login-incomplete"];
				renderComposer();
				return;
			}
			state.user = user;
			const { ownReview: listedReview } = partitionPluginReviews(
				state.reviews,
				null,
				state.user.id,
			);
			state.userReview = await loadUserReview().catch(
				() => listedReview || null,
			);
			state.busy = false;
			if (state.resumeDraftAfterSignIn) {
				state.resumeDraftAfterSignIn = false;
				state.editorError = "";
				state.expanded = true;
				renderComposer({ focus: true });
				renderReviews();
			} else {
				openEditor();
			}
		} catch {
			state.busy = false;
			state.editorError = strings["plugin-review:sign-in-failed"];
			renderComposer();
		}
	}

	async function saveReview() {
		if (state.busy) return;
		const review = validateReviewDraft({
			comment: state.draftComment,
			vote: state.draftVote,
		});
		if (review.errorKey || !hasReviewChanged(state.userReview, review)) return;

		state.busy = true;
		state.editorError = "";
		renderComposer();

		try {
			const result = await requestJson(Url.join(config.API_BASE, "comment"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					plugin_id: pluginId,
					comment: review.comment,
					vote: review.vote,
				}),
			});
			const previousReview = state.userReview;
			state.userReview = {
				...previousReview,
				id: result.id,
				plugin_id: pluginId,
				user_id: state.user.id,
				name: state.user.name,
				github: state.user.github,
				comment: result.comment,
				vote: result.vote,
				updated_at: new Date().toISOString(),
			};
			state.reviews = [
				state.userReview,
				...state.reviews.filter(
					(item) =>
						item.id !== state.userReview.id && item.user_id !== state.user.id,
				),
			];
			state.stats = updateReviewStats(
				state.stats,
				previousReview,
				state.userReview,
			);
			onStatsChange(state.stats);
			state.busy = false;
			state.expanded = false;
			state.editorError = "";
			state.resumeDraftAfterSignIn = false;
			renderComposer();
			renderReviews();
			toast(strings.success);
		} catch (error) {
			state.busy = false;
			if (error.status === 401) {
				state.user = null;
				state.expanded = false;
				state.resumeDraftAfterSignIn = true;
				state.editorError = strings["plugin-review:session-expired-review"];
				renderComposer();
			} else {
				state.editorError = strings["plugin-review:save-failed"];
				renderComposer({ focus: true });
			}
		}
	}

	async function deleteReview() {
		if (state.busy || !state.userReview?.id) return;
		const approved = await confirm(
			strings.delete,
			strings["plugin-review:delete-confirmation"],
			false,
			{
				direction: getLocaleDirection(locale),
				aboveOverlay: true,
			},
		);
		if (!approved || state.closed) return;

		state.busy = true;
		state.editorError = "";
		renderComposer();

		try {
			const previousReview = state.userReview;
			await requestJson(
				Url.join(config.API_BASE, "comment", previousReview.id),
				{
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
				},
			);
			state.reviews = state.reviews.filter(
				(item) =>
					item.id !== previousReview.id && item.user_id !== state.user.id,
			);
			state.stats = updateReviewStats(state.stats, previousReview, null);
			onStatsChange(state.stats);
			state.userReview = null;
			state.busy = false;
			state.expanded = false;
			renderComposer();
			renderReviews();
			toast(strings.success);
		} catch (error) {
			state.busy = false;
			if (error.status === 401) {
				state.user = null;
				state.expanded = false;
				state.editorError = strings["plugin-review:session-expired-continue"];
				renderComposer();
			} else {
				state.editorError = strings["plugin-review:delete-failed"];
				renderComposer({ focus: true });
			}
		}
	}

	async function retryReviews() {
		body.el.classList.add("loading");
		state.reviewListError = null;
		try {
			state.reviews = await loadReviews();
		} catch (error) {
			state.reviewListError = error;
		} finally {
			renderReviews();
		}
	}

	function loadReviews() {
		return fsOperation(config.API_BASE, `/comments/${pluginId}`).readFile(
			"json",
		);
	}

	async function loadUserReview() {
		const review = await requestJson(
			Url.join(config.API_BASE, "user", "comment", pluginId),
		);
		return review?.id ? review : null;
	}

	async function requestJson(url, options) {
		const response = await fetch(url, options);
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			const error = new Error();
			error.status = response.status;
			throw error;
		}
		return result;
	}

	function closeReviews() {
		if (state.closed) return;
		state.closed = true;
		removeDragListeners();
		actionStack.remove("reviews");
		container.el.classList.add("hide");

		setTimeout(() => {
			mask.el?.remove();
			container.el?.remove();
		}, 300);
	}

	/**
	 * @param {TouchEvent} e
	 */
	function ontouchstart(e) {
		if (state.closed || e.touches.length !== 1) return;
		removeDragListeners();
		const { clientY } = e.touches[0];
		const { top } = container.el.getBoundingClientRect();
		const y = clientY - top;
		let dy = 0;

		container.el.style.transition = "none";
		document.addEventListener("touchmove", ontouchmove);
		document.addEventListener("touchend", ontouchend);
		document.addEventListener("touchcancel", ontouchend);
		removeDragListeners = () => {
			document.removeEventListener("touchmove", ontouchmove);
			document.removeEventListener("touchend", ontouchend);
			document.removeEventListener("touchcancel", ontouchend);
		};

		function ontouchmove(e) {
			if (e.touches.length !== 1) return;
			const { clientY } = e.touches[0];
			dy = clientY - top - y;

			if (dy < 0) dy = 0;

			container.el.style.transform = `translateY(${dy}px)`;
		}

		function ontouchend() {
			removeDragListeners();
			if (dy < 100) {
				container.el.style.transition = "transform 0.3s ease-in-out";
				container.el.style.transform = "translateY(0)";
				return;
			}
			closeReviews();
		}
	}
}

function ReviewAvatar({ user, className = "review-avatar" }) {
	const avatarUrl = resolveReviewAvatarUrl(user);
	return (
		<span className={`${className} icon user-round`} aria-hidden="true">
			{avatarUrl ? (
				<img
					src={avatarUrl}
					alt=""
					onerror={(event) => event.currentTarget.remove()}
				/>
			) : null}
		</span>
	);
}

function autosizeReviewInput(textarea) {
	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
}

function getReviewString(key, replacements = {}) {
	let value = strings[key] || key;
	for (const [name, replacement] of Object.entries(replacements)) {
		value = value.replaceAll(`{${name}}`, String(replacement));
	}
	return value;
}

function Review({
	name,
	github,
	avatar_url: avatarUrl,
	updated_at: updatedAt,
	vote,
	comment,
	author,
	author_reply: authorReply,
	isOwn,
	onEdit,
	locale,
}) {
	const reviewDate = formatReviewDate(updatedAt, Date.now(), locale);
	const hasComment = typeof comment === "string" && Boolean(comment.trim());
	return (
		<article className={`review ${isOwn ? "own-review" : ""}`}>
			<div title={name} className="review-author">
				<ReviewAvatar
					user={{ avatar_url: avatarUrl, github }}
					className="user-profile"
				/>
				<span className="review-author-identity">
					<span className="user-name">
						{name}
						{isOwn ? <small>{strings["plugin-review:you"]}</small> : null}
					</span>
					{reviewDate ? (
						<time datetime={reviewDate.dateTime} title={reviewDate.title}>
							{reviewDate.relative}
						</time>
					) : null}
				</span>
				{vote ? (
					<span
						className={`review-vote-indicator ${vote === -1 ? "down" : "up"}`}
						aria-label={
							vote === -1
								? strings["plugin-review:thumbs-down"]
								: strings["plugin-review:thumbs-up"]
						}
					>
						<span className="icon like-solid"></span>
					</span>
				) : null}
				{isOwn ? (
					<button
						type="button"
						className="review-edit-button icon edit"
						aria-label={strings["plugin-review:edit-action"]}
						title={strings["plugin-review:edit-action"]}
						onclick={onEdit}
					></button>
				) : null}
			</div>
			{hasComment ? (
				<p className="review-body">{comment}</p>
			) : isOwn && Number(vote) === 1 ? (
				<p className="review-body review-vote-only">
					{strings["plugin-review:recommended"]}
				</p>
			) : null}
			{authorReply ? (
				<p className="author-reply" data-author={author}>
					{authorReply}
				</p>
			) : null}
		</article>
	);
}

function MoreInfo({ purchased, price, refund }) {
	if (!purchased) return "";

	return (
		<small className="more-info-small">
			<span>{strings.owned}</span> • <span>{price}</span> •{" "}
			<span className="link" onclick={refund}>
				{strings.refund}
			</span>
		</small>
	);
}
