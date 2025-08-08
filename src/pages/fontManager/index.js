export default function fontManager(...args) {
	import(/* webpackChunkName: "fontManager" */ "./fontManager").then(
		(module) => {
			module.default(...args);
		},
	);
}
