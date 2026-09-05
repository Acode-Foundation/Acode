export default function appIconSetting(...args) {
	return import(
		/* webpackChunkName: "appIconSetting" */ "./appIconSetting"
	).then((module) => module.default(...args));
}
