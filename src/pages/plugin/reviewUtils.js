export const REVIEW_MAX_COMMENT_LENGTH = 250;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parseReviewDate(value) {
	if (typeof value !== "string" || !value.trim()) return null;

	const trimmed = value.trim();
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
		trimmed,
	)
		? `${trimmed.replace(" ", "T")}Z`
		: trimmed;
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function formatReviewDate(value, now = Date.now(), locale = "en-US") {
	const date = parseReviewDate(value);
	const currentTime = now instanceof Date ? now.getTime() : Number(now);
	if (!date || !Number.isFinite(currentTime)) return null;

	const difference = date.getTime() - currentTime;
	const absoluteDifference = Math.abs(difference);
	let unit = "second";
	let amount = 0;

	if (absoluteDifference < 45 * SECOND) {
		amount = 0;
	} else if (absoluteDifference < 90 * SECOND) {
		unit = "minute";
		amount = Math.sign(difference);
	} else if (absoluteDifference < 45 * MINUTE) {
		unit = "minute";
		amount = Math.round(difference / MINUTE);
	} else if (absoluteDifference < 90 * MINUTE) {
		unit = "hour";
		amount = Math.sign(difference);
	} else if (absoluteDifference < 22 * HOUR) {
		unit = "hour";
		amount = Math.round(difference / HOUR);
	} else if (absoluteDifference < 36 * HOUR) {
		unit = "day";
		amount = Math.sign(difference);
	} else if (absoluteDifference < 26 * DAY) {
		unit = "day";
		amount = Math.round(difference / DAY);
	} else if (absoluteDifference < 45 * DAY) {
		unit = "month";
		amount = Math.sign(difference);
	} else if (absoluteDifference < 320 * DAY) {
		unit = "month";
		amount = Math.round(difference / (30 * DAY));
	} else if (absoluteDifference < 548 * DAY) {
		unit = "year";
		amount = Math.sign(difference);
	} else {
		unit = "year";
		amount = Math.round(difference / (365 * DAY));
	}

	const relative = new Intl.RelativeTimeFormat(locale, {
		numeric: "auto",
	}).format(amount, unit);

	return {
		dateTime: date.toISOString(),
		relative,
		title: date.toLocaleString(locale, {
			dateStyle: "medium",
			timeStyle: "short",
		}),
	};
}

export function resolveReviewAvatarUrl(user = {}) {
	const avatarUrl =
		typeof user?.avatar_url === "string" ? user.avatar_url.trim() : "";
	if (avatarUrl) return avatarUrl;

	const github = typeof user?.github === "string" ? user.github.trim() : "";
	return github ? `https://avatars.githubusercontent.com/${github}` : null;
}

function hasSameId(left, right) {
	if (left === null || left === undefined) return false;
	if (right === null || right === undefined) return false;
	return String(left) === String(right);
}

export function partitionPluginReviews(reviews = [], currentReview, userId) {
	const reviewList = Array.isArray(reviews) ? reviews : [];
	const ownReview =
		currentReview ||
		reviewList.find((review) => hasSameId(review?.user_id, userId)) ||
		null;
	const communityReviews = reviewList.filter((review) => {
		if (!review?.comment?.trim()) return false;
		if (hasSameId(review.user_id, userId)) return false;
		if (hasSameId(review.id, ownReview?.id)) return false;
		return !hasSameId(review.user_id, ownReview?.user_id);
	});

	return { ownReview, communityReviews };
}

export function normalizeReviewDraft(draft = {}) {
	const { comment = "", vote = 0 } = draft || {};
	return {
		comment: typeof comment === "string" ? comment.trim() : "",
		vote: [-1, 0, 1].includes(Number(vote)) ? Number(vote) : 0,
	};
}

export function validateReviewDraft(draft) {
	const normalized = normalizeReviewDraft(draft);

	if (normalized.comment.length > REVIEW_MAX_COMMENT_LENGTH) {
		return {
			...normalized,
			errorKey: "plugin-review:error-max-length",
		};
	}
	if (normalized.vote === -1 && !normalized.comment) {
		return {
			...normalized,
			errorKey: "plugin-review:error-downvote-comment",
		};
	}
	if (normalized.vote === 0 && !normalized.comment) {
		return { ...normalized, errorKey: "plugin-review:error-empty" };
	}

	return normalized;
}

export function hasReviewChanged(previousReview, nextReview) {
	const previous = normalizeReviewDraft(previousReview);
	const next = normalizeReviewDraft(nextReview);
	return previous.comment !== next.comment || previous.vote !== next.vote;
}

export function updateReviewStats(stats, previousReview, nextReview) {
	const previous = normalizeReviewDraft(previousReview);
	const next = normalizeReviewDraft(nextReview);
	let votesUp = Number(stats?.votesUp) || 0;
	let votesDown = Number(stats?.votesDown) || 0;
	let commentCount = Number(stats?.commentCount) || 0;

	if (previous.vote === 1) votesUp -= 1;
	if (previous.vote === -1) votesDown -= 1;
	if (next.vote === 1) votesUp += 1;
	if (next.vote === -1) votesDown += 1;
	if (previous.comment) commentCount -= 1;
	if (next.comment) commentCount += 1;

	return {
		votesUp: Math.max(0, votesUp),
		votesDown: Math.max(0, votesDown),
		commentCount: Math.max(0, commentCount),
	};
}

export function getRatingLabel(votesUp, votesDown) {
	const up = Number(votesUp) || 0;
	const down = Number(votesDown) || 0;
	const total = up + down;
	return total ? `${Math.round((up / total) * 100)}%` : "unrated";
}

export function getRatingClass(rating) {
	if (rating === "unrated") return "rating-value";
	const value = Number.parseInt(rating, 10);
	if (value >= 80) return "rating-value rating-high";
	if (value >= 50) return "rating-value rating-medium";
	return "rating-value rating-low";
}
