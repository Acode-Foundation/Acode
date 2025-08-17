import fsOperation from "fileSystem";
import TabView from "components/tabView";
import toast from "components/toast";
import alert from "dialogs/alert";
import DOMPurify from "dompurify";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import constants from "lib/constants";
import moment from "moment";
import helpers from "utils/helpers";
import Url from "utils/Url";

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
	} = props;

	let rating = "unrated";

	const keywords =
		typeof keywordsRaw === "string" ? JSON.parse(keywordsRaw) : keywordsRaw;
	const contributors =
		typeof contributorsRaw === "string"
			? JSON.parse(contributorsRaw)
			: contributorsRaw;

	if (votesUp || votesDown) {
		rating = `${Math.round((votesUp / (votesUp + votesDown)) * 100)}%`;
	}

	const formatUpdatedDate = (dateString) => {
		if (!dateString) return null;

		try {
			// Configure moment for shorter relative time format
			moment.updateLocale("en", {
				relativeTime: {
					future: "in %s",
					past: "%s ago",
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

			const updateTime = moment.utc(dateString);
			if (!updateTime.isValid()) return null;

			return updateTime.fromNow();
		} catch (error) {
			console.warn("Error parsing date with moment:", dateString, error);
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
						{repository
							? <a href={repository} className="source-indicator">
									<i className="icon github"></i>
									<span>{strings.open_source}</span>
								</a>
							: null}
					</div>
					<div className="plugin-meta">
						<span className="meta-item">
							<i className="licons tag" style={{ fontSize: "12px" }}></i>
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
							{authorVerified
								? <i
										on:click={() => {
											toast(strings["verified publisher"]);
										}}
										className="licons verified verified-tick"
									></i>
								: ""}
						</span>
						<span className="meta-item">
							<span
								className="licons scale"
								style={{ fontSize: "12px" }}
							></span>
							{license || "Unknown"}
						</span>
					</div>
					{votesUp !== undefined
						? <div className="metrics-row">
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
									<i className="icon favorite"></i>
									<span
										className={`rating-value ${rating === "unrated" ? "" : rating.replace("%", "") >= 80 ? "rating-high" : rating.replace("%", "") >= 50 ? "rating-medium" : "rating-low"}`}
									>
										{rating}
									</span>
								</div>
								<div
									className="metric"
									onclick={showReviews.bind(null, id, author)}
								>
									<i className="icon chat_bubble"></i>
									<span className="metric-value">{commentCount}</span>
									<span>{strings.reviews}</span>
								</div>
							</div>
						: null}
					{Array.isArray(keywords) && keywords.length
						? <div className="keywords">
								{keywords.map((keyword) => (
									<span className="keyword">{keyword}</span>
								))}
							</div>
						: null}
				</div>
				<div className="action-buttons">
					<Buttons {...props} />
				</div>
				<MoreInfo {...props} />
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
					<div
						id="overview"
						className="content-section active md"
						innerHTML={body}
					></div>
					<div id="contributors" className="content-section">
						{(() => {
							let contributorsList = contributors?.length
								? [
										{ name: author, role: "Developer", github: authorGithub },
										...contributors,
									]
								: [{ name: author, role: "Developer", github: authorGithub }];

							return contributorsList.map(({ name, role, github }) => {
								let dp = Url.join(constants.API_BASE, `../user.png`);
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
							DOMPurify.sanitize(changelogs) ||
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

function Buttons({
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
}) {
	if (
		typeof minVersionCode === "number" &&
		minVersionCode > BuildInfo.versionCode
	) {
		return (
			<div className="error">
				<span className="icon info"></span>
				<a href={constants.PLAY_STORE_URL} className="text">
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

	if (isPaid && !purchased && price) {
		return (
			<button data-type="buy" className="btn btn-install" onclick={buy}>
				<i className="licons cart"></i>
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

async function showReviews(pluginId, author) {
	const mask = Ref();
	const body = Ref();
	const container = Ref();

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
		<div ref={container} className="reviews-container">
			<div className="reviews-header" ontouchstart={ontouchstart}></div>
			<div className="write-review">
				<a
					style={{ textDecoration: "none", display: "flex" }}
					href={Url.join(constants.API_BASE, `../plugin/${pluginId}/comments`)}
				>
					<span className="icon edit"></span>
					<span className="title">Review</span>
				</a>
			</div>
			<div ref={body} className="reviews-body loading"></div>
		</div>,
	);

	try {
		const reviews = await fsOperation(
			constants.API_BASE,
			`/comments/${pluginId}`,
		).readFile("json");
		if (!reviews.length) {
			body.style.textAlign = "center";
			body.textContent = "No reviews yet";
			return;
		}

		reviews.forEach((review) => {
			if (!review.comment) return;
			review.author = author;
			body.append(<Review {...review} />);
		});
	} catch (error) {
		body.textContent = error.message;
	} finally {
		body.classList.remove("loading");
	}

	function closeReviews() {
		actionStack.remove("reviews");
		container.classList.add("hide");

		setTimeout(() => {
			mask.el.remove();
			container.el.remove();
		}, 300);
	}

	/**
	 * @param {TouchEvent} e
	 */
	function ontouchstart(e) {
		const { clientY } = e.touches[0];
		const { top } = container.el.getBoundingClientRect();
		const y = clientY - top;
		let dy = 0;

		container.style.transition = "none";
		document.addEventListener("touchmove", ontouchmove);
		document.addEventListener("touchend", ontouchend);
		document.addEventListener("touchcancel", ontouchend);

		function ontouchmove(e) {
			const { clientY } = e.touches[0];
			dy = clientY - top - y;

			if (dy < 0) dy = 0;

			container.style.transform = `translateY(${dy}px)`;
		}

		function ontouchend() {
			document.removeEventListener("touchmove", ontouchmove);
			document.removeEventListener("touchend", ontouchend);
			document.removeEventListener("touchcancel", ontouchcancel);
			if (dy < 100) {
				container.style.transition = "transform 0.3s ease-in-out";
				container.style.transform = "translateY(0)";
				return;
			}
			closeReviews();
		}
	}
}

function Review({
	name,
	github,
	vote,
	comment,
	author,
	author_reply: authorReply,
}) {
	let dp = Url.join(constants.API_BASE, `../user.png`);
	let voteImage = Ref();
	let review = Ref();

	if (github) {
		dp = `https://avatars.githubusercontent.com/${github}`;
	}

	if (vote === 1) {
		voteImage.style.backgroundImage = `url(${Url.join(constants.API_BASE, `../thumbs-up.gif`)})`;
	} else if (vote === -1) {
		voteImage.style.backgroundImage = `url(${Url.join(constants.API_BASE, `../thumbs-down.gif`)})`;
	}

	if (authorReply) {
		setTimeout(() => {
			review.append(
				<p className="author-reply" data-author={author}>
					{authorReply}
				</p>,
			);
		}, 0);
	}

	return (
		<div ref={review} className="review">
			<div title={name} className="review-author">
				<span
					style={{ backgroundImage: `url(${dp})` }}
					className="user-profile"
				></span>
				<span className="user-name">{name}</span>
				<span ref={voteImage} className="vote"></span>
			</div>
			<p className="review-body">{comment}</p>
		</div>
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
