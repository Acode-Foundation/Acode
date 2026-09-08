import { describe, expect, it } from "vitest";
import { getIntlLocale, getLocaleDirection } from "lib/lang";
import {
	formatReviewDate,
	getRatingClass,
	getRatingLabel,
	hasReviewChanged,
	normalizeReviewDraft,
	partitionPluginReviews,
	resolveReviewAvatarUrl,
	updateReviewStats,
	validateReviewDraft,
} from "pages/plugin/reviewUtils";

describe("plugin review dates", () => {
	it("formats database timestamps as website-style relative dates", () => {
		const formatted = formatReviewDate(
			"2026-08-26 12:00:00",
			Date.parse("2026-08-28T12:00:00Z"),
			"en-US",
		);

		expect(formatted?.dateTime).toBe("2026-08-26T12:00:00.000Z");
		expect(formatted?.relative).toBe("2 days ago");
		expect(formatted?.title).toBeTruthy();
	});

	it("uses the selected locale for relative and absolute dates", () => {
		const value = "2026-08-26 12:00:00";
		const now = Date.parse("2026-08-28T12:00:00Z");
		const formatted = formatReviewDate(value, now, "fr-FR");
		const date = new Date("2026-08-26T12:00:00Z");

		expect(formatted?.relative).toBe(
			new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" }).format(
				-2,
				"day",
			),
		);
		expect(formatted?.title).toBe(
			date.toLocaleString("fr-FR", {
				dateStyle: "medium",
				timeStyle: "short",
			}),
		);
	});

	it("normalizes Acode-specific locale codes", () => {
		expect(getIntlLocale("pu-in")).toBe("pa-IN");
		expect(getIntlLocale("ir-fa")).toBe("fa-IR");
		expect(getIntlLocale("mm-unicode")).toBe("my-MM");
		expect(getIntlLocale("mm-zawgyi")).toBe("my-MM");
		expect(getLocaleDirection("fa-IR")).toBe("rtl");
		expect(getLocaleDirection("ar-YE")).toBe("rtl");
		expect(getLocaleDirection("he-IL")).toBe("rtl");
		expect(getLocaleDirection("de-DE")).toBe("ltr");
	});

	it("hides missing or invalid review dates", () => {
		expect(formatReviewDate()).toBeNull();
		expect(formatReviewDate("not-a-date")).toBeNull();
	});
});

describe("plugin review avatars", () => {
	it("prefers an explicit avatar and falls back to GitHub", () => {
		expect(
			resolveReviewAvatarUrl({
				avatar_url: " https://example.com/avatar.png ",
				github: "acode-foundation",
			}),
		).toBe("https://example.com/avatar.png");
		expect(resolveReviewAvatarUrl({ github: " acode-foundation " })).toBe(
			"https://avatars.githubusercontent.com/acode-foundation",
		);
	});

	it("uses the local placeholder when no avatar is available", () => {
		expect(resolveReviewAvatarUrl()).toBeNull();
		expect(resolveReviewAvatarUrl({ avatar_url: " ", github: " " })).toBeNull();
	});
});

describe("plugin review ordering", () => {
	it("pins and deduplicates the current user's review across id types", () => {
		const reviews = [
			{ id: 1, user_id: 10, comment: "First" },
			{ id: 2, user_id: "7", comment: "Mine from the list" },
			{ id: 3, user_id: 11, comment: "Second" },
		];
		const currentReview = {
			id: "2",
			user_id: 7,
			comment: "",
			vote: 1,
		};

		expect(partitionPluginReviews(reviews, currentReview, "7")).toEqual({
			ownReview: currentReview,
			communityReviews: [reviews[0], reviews[2]],
		});
	});
});

describe("plugin review draft", () => {
	it("normalizes whitespace and preserves valid votes", () => {
		expect(normalizeReviewDraft({ comment: "  Very useful  ", vote: "1" })).toEqual(
			{
				comment: "Very useful",
				vote: 1,
			},
		);
	});

	it("supports an upvote without text and validates negative feedback", () => {
		expect(validateReviewDraft({ vote: 1 })).toEqual({ comment: "", vote: 1 });
		expect(validateReviewDraft({ comment: " ", vote: -1 }).errorKey).toBe(
			"plugin-review:error-downvote-comment",
		);
		expect(validateReviewDraft({ comment: " ", vote: 0 }).errorKey).toBe(
			"plugin-review:error-empty",
		);
	});

	it("enforces the 250 character limit", () => {
		expect(validateReviewDraft({ comment: "x".repeat(250), vote: 0 })).toEqual({
			comment: "x".repeat(250),
			vote: 0,
		});
		expect(
			validateReviewDraft({ comment: "x".repeat(251), vote: 0 }).errorKey,
		).toBe("plugin-review:error-max-length");
	});

	it("compares normalized drafts to prevent duplicate submissions", () => {
		expect(
			hasReviewChanged(
				{ comment: "Useful", vote: 1 },
				{ comment: "  Useful  ", vote: "1" },
			),
		).toBe(false);
		expect(
			hasReviewChanged(
				{ comment: "Useful", vote: 1 },
				{ comment: "Updated", vote: 1 },
			),
		).toBe(true);
	});
});

describe("plugin review metrics", () => {
	it("moves votes and comment counts without inflation", () => {
		expect(
			updateReviewStats(
				{ votesUp: 8, votesDown: 2, commentCount: 4 },
				{ vote: 1, comment: "Old" },
				{ vote: -1, comment: "New" },
			),
		).toEqual({ votesUp: 7, votesDown: 3, commentCount: 4 });
	});

	it("handles vote-only reviews and deletion", () => {
		const added = updateReviewStats(
			{ votesUp: 0, votesDown: 0, commentCount: 0 },
			null,
			{ vote: 1, comment: "" },
		);
		expect(added).toEqual({ votesUp: 1, votesDown: 0, commentCount: 0 });
		expect(updateReviewStats(added, { vote: 1 }, null)).toEqual({
			votesUp: 0,
			votesDown: 0,
			commentCount: 0,
		});
	});

	it("formats rating labels and visual states", () => {
		expect(getRatingLabel(0, 0)).toBe("unrated");
		expect(getRatingLabel(8, 2)).toBe("80%");
		expect(getRatingClass("80%")).toContain("rating-high");
		expect(getRatingClass("50%")).toContain("rating-medium");
		expect(getRatingClass("49%")).toContain("rating-low");
	});
});
