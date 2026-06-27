import "./styles.scss";
import Ref from "html-tag-js/ref";
import { animate } from "motion";

/**
 * @typedef {Object} Checkbox
 * @property {string} text
 * @property {Ref} ref
 * @property {boolean} checked
 * @property {string} [name]
 * @property {string} [id]
 * @property {string} [size]
 * @property {"checkbox"|"radio"} [type]
 */

/**
 * Create a checkbox
 * @param {string | Checkbox} text Checkbox label
 * @param {Boolean} checked Whether checkbox is checked or not
 * @param {string} [name] Name of checkbox
 * @param {string} [id] Id of checkbox
 * @param {"checkbox"|"radio"} [type] Type of checkbox
 * @param {Ref} [ref] A reference to the input element
 * @param {string} [size] Size of checkbox
 * @returns {Checkbox & HTMLLabelElement}
 */
function Checkbox(text, checked, name, id, type, ref, size, isSwitch) {
	if (typeof text === "object") {
		({ text, checked, name, id, type, ref, size, isSwitch } = text);
	}

	size = size || "1rem";

	const $input = ref || Ref();
	const $handle = Ref();
	const $checkbox = (
		<label className={`input-checkbox ${isSwitch ? "switch" : ""}`}>
			<input
				ref={$input}
				checked={checked}
				type={type || "checkbox"}
				name={name}
				id={id}
				onchange={handleChange}
			/>
			<span style={{ height: size, width: size }} className="box">
				<span ref={$handle} className="handle"></span>
			</span>
			<span>{text}</span>
		</label>
	);

	function updateToggle(animateToggle = true) {
		const isSwitch =
			$checkbox.classList.contains("switch") ||
			$checkbox.closest(
				".detail-settings-list, .main-settings-list, .settings-search-section",
			) !== null;

		if (isSwitch && $handle.el) {
			const isChecked = !!$input.el.checked;
			const targetTransform = isChecked
				? "translate3d(1.12rem, 0, 0)"
				: "translate3d(0, 0, 0)";

			if (animateToggle) {
				animate(
					$handle.el,
					{
						transform: targetTransform,
					},
					{
						type: "spring",
						stiffness: 500,
						damping: 28,
					},
				).then(() => {
					$handle.el.style.transform = targetTransform;
				});
			} else {
				$handle.el.style.transform = targetTransform;
			}
		}
	}

	function handleChange() {
		updateToggle(true);
	}

	requestAnimationFrame(() => {
		updateToggle(false);
	});

	Object.defineProperties($checkbox, {
		checked: {
			get() {
				return !!$input.el.checked;
			},
			set(value) {
				$input.el.checked = value;
				updateToggle(true);
			},
		},
		onclick: {
			get() {
				return $input.el.onclick;
			},
			set(onclick) {
				$input.el.onclick = onclick;
			},
		},
		onchange: {
			get() {
				return $input.el.onchange;
			},
			set(onchange) {
				$input.el.onchange = onchange;
			},
		},
		value: {
			get() {
				return this.checked;
			},
			set(value) {
				this.checked = value;
			},
		},
		toggle: {
			value() {
				this.checked = !this.checked;
			},
		},
	});

	return $checkbox;
}

export default Checkbox;
