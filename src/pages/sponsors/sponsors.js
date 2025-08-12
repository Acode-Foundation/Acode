import ajax from "@deadlyjack/ajax";
import "./style.scss";
import Page from "components/page";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import constants from "lib/constants";
import Sponsor from "pages/sponsor";
import helpers from "utils/helpers";

export default function Sponsors() {
	const page = Page("Sponsors");
	const titaniumSponsors = Ref();
	const platinumSponsors = Ref();
	const goldSponsors = Ref();
	const silverSponsors = Ref();
	const bronzeSponsors = Ref();
	const crystalSponsors = Ref();
	let cancel = false;

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
				<p class="cta-text">
					Join our community of supporters and help shape the future of mobile
					development
				</p>
				<button class="cta-button" onclick={() => Sponsor(render)}>
					Become a Sponsor <span className="icon favorite"></span>
				</button>
			</div>
			<div className="sponsors-container">
				<h2>Acode's Sponsors</h2>
				<div className="sponsors-list">
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon titanium"></span>Titanium
						</div>
						<div
							className="sponsors"
							data-empty-message="Be the first Titanium Sponsor!"
							ref={titaniumSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon platinum"></span>Platinum
						</div>
						<div
							className="sponsors"
							data-empty-message="Be the first Platinum Sponsor!"
							ref={platinumSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon gold"></span>Gold
						</div>
						<div
							className="sponsors"
							data-empty-message="Be the first Gold Sponsor!"
							ref={goldSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon silver"></span>Silver
						</div>
						<div
							className="sponsors"
							data-empty-message="Be the first Silver Sponsor!"
							ref={silverSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon bronze"></span>Bronze
						</div>
						<div
							className="sponsors"
							data-empty-message="Be the first Bronze Sponsor!"
							ref={bronzeSponsors}
						></div>
					</div>
					<div className="tier">
						<div className="tier-name">
							<span className="tier-icon crystal"></span>Crystal
						</div>
						<div
							className="sponsors"
							data-empty-message="Be the first Crystal Sponsor!"
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
		try {
			const res = await ajax.get(`${constants.API_BASE}/sponsors`);
			if (res.error) {
				helpers.error(res.error);
			} else {
				titaniumSponsors.content = "";
				platinumSponsors.content = "";
				goldSponsors.content = "";
				silverSponsors.content = "";
				bronzeSponsors.content = "";
				crystalSponsors.content = "";

				for (const sponsor of res) {
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
		} catch (error) {
			helpers.error(error);
		}
	}
}

function SponsorCard({ name, image, website, tier, tagline }) {
	// for crystal tier only text, for bronze slightly bigger text, for silver bigger clickable text,
	// for gold text with image, for platinum and titanium text with big image

	return (
		<div
			attr-role="button"
			className={`sponsor-card ${tier}`}
			onclick={() => {
				if (!website.startsWith("http")) {
					website = "http://" + website;
				}
				system.openInBrowser(website);
			}}
		>
			<div className="sponsor-avatar">
				<img src={`https://acode.app/sponsor/image/${image}`} />
			</div>
			<div className="sponsor-name">{name}</div>
			<div className="sponsor-tagline">{tagline}</div>
			{website && <small className="sponsor-website">{website}</small>}
		</div>
	);
}
