import "./adRewards.scss";

import Page from "components/page";
import loader from "dialogs/loader";
import actionStack from "lib/actionStack";
import adRewards from "lib/adRewards";
import removeAds from "lib/removeAds";
import helpers from "utils/helpers";

let $rewardPage = null;

export default function openAdRewardsPage() {
	if ($rewardPage) {
		$rewardPage.show?.();
		return $rewardPage;
	}

	const $page = Page("Ad-free passes");

	function render() {
		const rewardState = adRewards.getState();
		const rewardedSupported = adRewards.isRewardedSupported();
		const unavailableReason = adRewards.getRewardedUnavailableReason();
		const offers = adRewards.getOffers();
		const isBusy = adRewards.isWatchingReward();
		const redemptionStatus = adRewards.canRedeemNow();
		const rewardDisabledReason = !rewardedSupported
			? unavailableReason
			: !redemptionStatus.ok
				? redemptionStatus.reason
				: "";

		$page.body = (
			<main id="ad-rewards-page" className="main scroll">
				<section className="reward-hero">
					<div className="hero-copy">
						<div className="eyebrow">Rewarded ads</div>
						<h1>Trade a short ad break for focused coding time.</h1>
						<p>
							Unlock temporary ad-free time without leaving the free version.
							When your pass expires, Acode will show a toast and add a
							notification in-app.
						</p>
					</div>
					<div
						className={`reward-status ${rewardState.isActive ? "is-active" : "is-idle"}`}
					>
						<div className="status-label">
							{rewardState.isActive ? "Ad-free active" : "No active pass"}
						</div>
						<div className="status-value">
							{rewardState.isActive
								? adRewards.getRemainingLabel()
								: "Watch a rewarded ad to start a pass"}
						</div>
						<div className="status-note">
							{rewardState.isActive
								? `Expires ${adRewards.getExpiryLabel()}`
								: "Passes stack on top of any active rewarded time."}
						</div>
						<div className="status-subnote">
							{rewardState.redemptionsToday}/{rewardState.maxRedemptionsPerDay}{" "}
							rewards used today
						</div>
					</div>
				</section>

				<section className="reward-grid">
					{offers.map((offer) => (
						<article className={`reward-offer ${offer.accentClass}`}>
							<div className="offer-header">
								<div>
									<div className="offer-kicker">
										{offer.adsRequired} rewarded ad
										{offer.adsRequired > 1 ? "s" : ""}
									</div>
									<h2>{offer.title}</h2>
								</div>
								<div className="offer-duration">{offer.durationLabel}</div>
							</div>
							<p>{offer.description}</p>
							<button
								type="button"
								className="offer-action"
								disabled={!rewardedSupported || isBusy || !redemptionStatus.ok}
								onclick={() => watchOffer(offer.id)}
							>
								{isBusy
									? "Loading ad..."
									: `Watch ${offer.adsRequired} ad${offer.adsRequired > 1 ? "s" : ""}`}
							</button>
							<div className="offer-limit">
								{rewardDisabledReason ||
									`${rewardState.remainingRedemptions} of ${rewardState.maxRedemptionsPerDay} rewards left today`}
							</div>
						</article>
					))}

					<article className="reward-offer is-upgrade">
						<div className="offer-header">
							<div>
								<div className="offer-kicker">Permanent option</div>
								<h2>Remove ads for good</h2>
							</div>
							<div className="offer-duration">One purchase</div>
						</div>
						<p>
							If you use Acode daily, Pro still gives the cleanest experience.
						</p>
						<button
							type="button"
							className="offer-action secondary"
							onclick={purchaseRemoveAds}
						>
							Buy remove ads
						</button>
					</article>
				</section>

				<section className="reward-notes">
					<div className="note-card">
						<h3>How it works</h3>
						<p>
							Rewarded passes hide your banners and interstitials until the
							timer ends. If you already have time left, new rewards extend the
							expiry.
						</p>
					</div>
					<div className="note-card">
						<h3>Limits</h3>
						<p>
							You can redeem up to {rewardState.maxRedemptionsPerDay} rewards
							per day, and your active ad-free pass is capped at 10 hours.
						</p>
					</div>
				</section>
			</main>
		);
	}

	async function purchaseRemoveAds() {
		try {
			loader.showTitleLoader();
			await removeAds();
			$page.hide();
		} catch (error) {
			helpers.error(error);
		} finally {
			loader.removeTitleLoader();
		}
	}

	async function watchOffer(offerId) {
		try {
			render();
			await adRewards.watchOffer(offerId);
		} catch (error) {
			helpers.error(error);
		} finally {
			render();
		}
	}

	const unsubscribe = adRewards.onChange(() => {
		if ($page.isConnected) {
			render();
		}
	});

	$page.onhide = () => {
		unsubscribe();
		actionStack.remove("ad-rewards");
		helpers.showAd();
		$rewardPage = null;
	};

	actionStack.push({
		id: "ad-rewards",
		action: $page.hide,
	});

	helpers.hideAd(true);
	render();
	app.append($page);
	$rewardPage = $page;

	return $page;
}
