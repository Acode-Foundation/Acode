import "./style.scss";
import Page from "components/page";
import toast from "components/toast";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import config from "lib/config";
import Sponsor from "pages/sponsor";
import helpers from "utils/helpers";

export default function Sponsors() {
	const page = Page(strings["sponsors"]);
	const titaniumSponsors = Ref();
	const platinumSponsors = Ref();
	const goldSponsors = Ref();
	const silverSponsors = Ref();
	const bronzeSponsors = Ref();
	const crystalSponsors = Ref();
	let cancel = false;

	let sponsorLists = [
		"Crystal",
		"Bronze",
		"Silver",
		"Gold",
		"Platinum",
		"Titanium",
	];

	actionStack.push({
		id: "sponsors_page",
		action: page.hide,
	});

	page.onhide = () => {
		actionStack.remove("sponsors_page");
		cancel = true;
	};

	page.body = (
		<div id="sponsors-page">
			<div className="cta-section">
				<p class="cta-text">{strings["sponsors:join-our-community"]}</p>
				<button class="cta-button" onclick={() => Sponsor(render)}>
					{strings["sponsors:become-a-sponsor"]}{" "}
					<span className="icon favorite"></span>
				</button>
			</div>
			<div className="sponsors-container">
				<h2>{strings["sponsors:acode-sponsors"]}</h2>
				<div className="sponsors-list" onclick={handleLinkClick}>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon titanium"></span>
							{sponsorLists[5]}
						</div>
						<div
							className="sponsors"
							data-empty-message={strings["sponsors:be-the-first"].replace(
								/\{tier\}/g,
								sponsorLists[5],
							)}
							ref={titaniumSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon platinum"></span>
							{sponsorLists[4]}
						</div>
						<div
							className="sponsors"
							data-empty-message={strings["sponsors:be-the-first"].replace(
								/\{tier\}/g,
								sponsorLists[4],
							)}
							ref={platinumSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon gold"></span>
							{sponsorLists[3]}
						</div>
						<div
							className="sponsors"
							data-empty-message={strings["sponsors:be-the-first"].replace(
								/\{tier\}/g,
								sponsorLists[3],
							)}
							ref={goldSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon silver"></span>
							{sponsorLists[2]}
						</div>
						<div
							className="sponsors"
							data-empty-message={strings["sponsors:be-the-first"].replace(
								/\{tier\}/g,
								sponsorLists[2],
							)}
							ref={silverSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon bronze"></span>
							{sponsorLists[1]}
						</div>
						<div
							className="sponsors"
							data-empty-message={strings["sponsors:be-the-first"].replace(
								/\{tier\}/g,
								sponsorLists[1],
							)}
							ref={bronzeSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon crystal"></span>
							{sponsorLists[0]}
						</div>
						<div
							className="sponsors"
							data-empty-message={strings["sponsors:be-the-first"].replace(
								/\{tier\}/g,
								sponsorLists[0],
							)}
							ref={crystalSponsors}
						></div>
					</div>
				</div>
			</div>
		</div>
	);

	render();
	app.append(page);

	async function render() {
		let sponsors = [];
		try {
			const res = await fetch(`${config.API_BASE}/sponsors`);
			if (!res.ok) {
				throw new Error("Failed to fetch sponsor");
			}

			const sponsorList = await res.json();
			if (sponsorList.error) {
				toast(strings["unable to load sponsors"]);
				console.error("Error loading sponsors:", sponsorList.error);
			} else {
				sponsors = sponsorList;
				localStorage.setItem("cached_sponsors", JSON.stringify(sponsors));
			}
		} catch (error) {
			toast(strings["unable to load sponsors"]);
			console.error("Error loading sponsors:", error);
		}

		if (!sponsors.length && "cached_sponsors" in localStorage) {
			try {
				const cachedSponsors = helpers.parseJSON(
					localStorage.getItem("cached_sponsors"),
				);
				sponsors = Array.isArray(cachedSponsors) ? cachedSponsors : [];
			} catch (error) {
				console.error("Failed to parse cached sponsors", error);
			}
		}

		titaniumSponsors.content = "";
		platinumSponsors.content = "";
		goldSponsors.content = "";
		silverSponsors.content = "";
		bronzeSponsors.content = "";
		crystalSponsors.content = "";

		for (const sponsor of sponsors) {
			// Append each sponsor to the corresponding tier
			switch (sponsor.tier) {
				case "titanium":
					titaniumSponsors.append(<SponsorCard {...sponsor} />);
					break;
				case "platinum":
					platinumSponsors.append(<SponsorCard {...sponsor} />);
					break;
				case "gold":
					goldSponsors.append(<SponsorCard {...sponsor} />);
					break;
				case "silver":
					silverSponsors.append(<SponsorCard {...sponsor} />);
					break;
				case "bronze":
					bronzeSponsors.append(<SponsorCard {...sponsor} />);
					break;
				case "crystal":
					crystalSponsors.append(<SponsorCard {...sponsor} />);
					break;
			}
		}
	}
}

/**
 * Sponsor Card Component
 * @param {object} props
 * @param {string} props.name - The name of the sponsor
 * @param {string} props.image - The image URL of the sponsor
 * @param {string} props.website - The website URL of the sponsor
 * @param {string} props.tier - The tier of the sponsor
 * @param {string} props.tagline - The tagline of the sponsor
 * @returns {JSX.Element}
 */
function SponsorCard({ name, image, website, tier, tagline }) {
	// for crystal tier only text, for bronze slightly bigger text, for silver bigger clickable text,
	// for gold text with image, for platinum and titanium text with big image

	return (
		<div
			attr-role="button"
			data-website={website}
			className={`sponsor-card ${tier}`}
		>
			{image && (
				<div className="sponsor-avatar">
					<img src={`https://acode.app/sponsor/image/${image}`} />
				</div>
			)}
			<div className="sponsor-name">{name}</div>
			{tagline && <div className="sponsor-tagline">{tagline}</div>}
			{website && <small className="sponsor-website">{website}</small>}
		</div>
	);
}

/**
 * Handle link click
 * @param {MouseEvent} e
 * @returns
 */
function handleLinkClick(e) {
	const target = e.target.closest(".sponsor-card");
	if (!target) return;
	const { website } = target.dataset;
	if (!website) return;
	if (!website.startsWith("http")) {
		website = "http://" + website;
	}
	system.openInBrowser(website);
}
