import tailSpinSvg from "res/tail-spin.svg?raw";

const tailSpinGradientId = "tail-spin-gradient";
let tailSpinSvgId = 0;

const createTailSpinSvg = () => {
	const gradientId = `${tailSpinGradientId}-${tailSpinSvgId++}`;
	return tailSpinSvg.replaceAll(tailSpinGradientId, gradientId);
};

Object.defineProperty(createTailSpinSvg, "name", {
	value: "createTailSpinSvg",
});

export default createTailSpinSvg;
