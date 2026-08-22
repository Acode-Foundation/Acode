export default function AiAgentPage() {
	import(/* webpackChunkName: "aiAgent" */ "./aiAgent").then((res) => {
		res.default();
	});
}
