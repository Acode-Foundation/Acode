//jshint ignore:start

function AiAssistant() {
	import(/* webpackChunkName: "aiAssistant" */ "./assistant").then((res) => {
		res.default();
	});
}
export default AiAssistant;
