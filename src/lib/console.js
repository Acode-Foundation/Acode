import "core-js/stable";
import "html-tag-js/dist/polyfill";
import * as esprima from "esprima";
import css from "styles/console.m.scss";
import loadPolyFill from "utils/polyfill";

(function () {
	loadPolyFill.apply(window);

	let consoleVisible = false;
	const originalConsole = console;
	const $input = tag("textarea", {
		id: "__c-input",
		onblur() {
			setTimeout(() => {
				isFocused = false;
			}, 0);
		},
	});
	const $inputContainer = tag("c-input", {
		child: $input,
	});
	const $toggler = tag("c-toggler", {
		style: {
			transform: `translate(2px, ${innerHeight / 2}px)`,
		},
		onclick() {
			consoleVisible = !consoleVisible;
			if (consoleVisible) {
				showConsole();
			} else {
				hideConsole();
			}
		},
		ontouchstart() {
			document.addEventListener("touchmove", touchmove, {
				passive: false,
			});

			document.ontouchend = function (e) {
				document.removeEventListener("touchmove", touchmove, {
					passive: "false",
				});
				document.ontouchend = null;
			};
		},
	});
	const $console = tag("c-console", {
		child: $inputContainer,
		onclick(e) {
			const el = e.target;
			const action = el.getAttribute("action");

			switch (action) {
				case "use code":
					const value = el.getAttribute("data-code");

					$input.value = value;
					$input.focus();
					break;

				default:
					break;
			}
		},
	});
	const counter = {};
	const timers = {};
	let isFocused = false;

	if (!window.__objs) window.__objs = {};

	if (!tag.get("c-console")) {
		const $style = tag("style");
		$style.textContent = css;
		document.head.append($style);
		window.addEventListener("error", onError);
		assignCustomConsole();

		if (sessionStorage.getItem("__mode") === "console") {
			showConsole();
			return;
		}

		tag.get("html").append($toggler);
		$console.setAttribute("title", "Console");
		sessionStorage.setItem("__console_available", true);
		document.addEventListener("showconsole", showConsole);
		document.addEventListener("hideconsole", hideConsole);
	}

	function touchmove(e) {
		e.preventDefault();
		$toggler.style.transform = "translate("
			.concat(e.touches[0].clientX - 20, "px, ")
			.concat(e.touches[0].clientY - 20, "px)");
	}

	function assignCustomConsole() {
		window.console = {
			assert(condition, msg, ...substitution) {
				originalConsole.assert(condition, msg, ...substitution);
				if (!condition) {
					log("error", getStack(new Error()), msg, ...substitution);
				}
			},
			clear() {
				originalConsole.clear();
				if (isFocused) $input.focus();
				$console.textContent = "";
				$console.appendChild($inputContainer);
			},
			count(hash = "default") {
				originalConsole.count(hash);
				if (!counter[hash]) {
					counter[hash] = 1;
				} else {
					++counter[hash];
				}
				log("log", getStack(new Error()), `${hash}: ${counter[hash]}`);
			},
			countReset(hash) {
				originalConsole.countReset(hash);
				delete counter[hash];
			},
			debug(...args) {
				originalConsole.debug(...args);
				log("log", getStack(new Error()), ...args);
			},
			dir(...args) {
				originalConsole.dir(...args);
				log("log", getStack(new Error()), ...args);
			},
			dirxml(...args) {
				originalConsole.dirxml(...args);
				log("log", getStack(new Error()), ...args);
			},
			error(...args) {
				originalConsole.error(...args);
				log("error", getStack(new Error()), ...args);
			},
			group(...args) {
				originalConsole.group(...args);
				log("log", getStack(new Error()), ...args);
			},
			groupCollapsed(...args) {
				originalConsole.groupCollapsed(...args);
				log("log", getStack(new Error()), ...args);
			},
			groupEnd(...args) {
				originalConsole.groupEnd(...args);
				log("log", getStack(new Error()), ...args);
			},
			info(...args) {
				originalConsole.info(...args);
				log("info", getStack(new Error()), ...args);
			},
			log(msg, ...substitution) {
				originalConsole.log(msg, ...substitution);
				log("log", getStack(new Error()), msg, ...substitution);
			},
			table(...args) {
				originalConsole.table(...args);
				log("log", getStack(new Error()), ...args);
			},
			time(label = "default") {
				originalConsole.time(label);
				if (typeof label !== "string") {
					throw new TypeError("label must be a string");
				}
				timers[label] = new Date().getTime();
			},
			timeEnd(label = "default") {
				originalConsole.timeEnd(label);
				if (typeof label !== "string") {
					throw new TypeError("label must be a string");
				}
				if (!timers[label]) {
					throw new Error(`No such label: ${label}`);
				}
				const time = new Date().getTime() - timers[label];
				log("log", getStack(new Error()), `${label}: ${time}ms`);
				delete timers[label];
			},
			timeLog(label = "default") {
				originalConsole.timeLog(label);
				if (typeof label !== "string") {
					throw new TypeError("label must be a string");
				}
				if (!timers[label]) {
					throw new Error(`No such label: ${label}`);
				}
				const time = new Date().getTime() - timers[label];
				log("log", getStack(new Error()), `${label}: ${time}ms`);
			},
			trace(...args) {
				originalConsole.trace(...args);
				log("trace", getStack(new Error()), ...args);
			},
			warn(msg, ...substitution) {
				originalConsole.warn(msg, ...substitution);
				log("warn", getStack(new Error()), msg, ...substitution);
			},
		};
	}

	function showConsole() {
		tag.get("html").append($console);
		$input.addEventListener("keydown", onCodeInput);
	}

	function hideConsole() {
		$console.remove();
		$input.removeEventListener("keydown", onCodeInput);
	}

	function onCodeInput(e) {
		const key = e.key;
		isFocused = true;
		if (key === "Enter") {
			const regex = /[\[|{\(\)\}\]]/g;
			let code = this.value.trim();
			let isOdd = (code.length - code.replace(regex, "").length) % 2;

			if (!code || isOdd) return;
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();

			log("code", {}, code);
			$input.value = "";
			const res = execute(code);
			if (res.type === "error") {
				log("error", getStack(new Error()), res.value);
			} else {
				log("log", getStack(new Error()), res.value);
			}
		}
	}

	function getBody(obj, ...keys) {
		if (obj instanceof Promise && !("[[PromiseStatus]]" in obj))
			obj = getPromiseStatus(obj);

		let value = objValue(obj, ...keys);
		const $group = tag("c-group");
		const $toggler = tag("c-type", {
			attr: {
				type: "body-toggler",
			},
			textContent: value ? value.constructor.name : value + "",
		});

		if (value instanceof Object) {
			$toggler.onclick = function () {
				if (this.classList.contains("__show-data")) {
					this.classList.remove("__show-data");
					$group.textContent = null;
					return;
				}

				this.classList.toggle("__show-data");

				const possibleKeys = [];

				for (let key in value) {
					possibleKeys.push(key);
				}

				possibleKeys.push(
					...[
						...Object.keys(value),
						...Object.getOwnPropertyNames(value),
						...Object.keys(value["__proto__"] || {}),
					],
				);

				if (value["__proto__"]) possibleKeys.push("__proto__");
				if (value["prototype"]) possibleKeys.push("prototype");

				[...new Set(possibleKeys)].forEach((key) =>
					$group.append(appendProperties(obj, ...keys, key)),
				);
			};
			$toggler.textContent = value.constructor.name;
		} else {
			const $val = getElement(value);
			$val.textContent = (value ?? value + "").toString();
			$group.append($val);
		}

		return [$toggler, $group];
	}

	function appendProperties(obj, ...keys) {
		const key = keys.pop();
		const value = objValue(obj, ...keys);
		const getter = value.__lookupGetter__(key);
		const $key = tag("c-key", {
			textContent: key + ":",
		});
		let $val;

		if (getter) {
			$val = tag("c-span", {
				style: {
					textDecoration: "underline",
					color: "#39f",
					margin: "0 10px",
				},
				textContent: `...`,
				onclick() {
					const $val = getVal(value[key]);
					this.parentElement.replaceChild($val, this);
				},
			});
		} else {
			$val = getVal(value[key]);
		}

		return tag("c-line", {
			children: [$key, $val],
		});

		function getVal(val) {
			const type = typeof val;
			const $val = getElement(type);
			if (type === "object" && val !== null) {
				$val.append(...getBody(obj, ...keys, key));
			} else {
				if (type === "function") {
					val = parseFunction(val);
				}
				$val.textContent = val + "";
			}
			return $val;
		}
	}

	function objValue(obj, ...keys) {
		return keys.reduce((acc, key) => acc[key], obj);
	}

	function getPromiseStatus(obj) {
		if (obj.info) return;
		let status = "pending";
		let value;
		let result = obj.then(
			(val) => {
				status = "resolved";
				value = val;
			},
			(val) => {
				status = "rejected";
				value = val;
			},
		);

		Object.defineProperties(result, {
			"[[PromiseStatus]]": {
				get: () => status,
			},
			"[[PromiseValue]]": {
				get: () => value,
			},
		});

		return result;
	}

	function getElement(type) {
		return tag("c-text", {
			className: `__c-${type}`,
		});
	}

	function parseFunction(data) {
		let parsed;
		let str;

		try {
			parsed = esprima.parse(data.toString()).body[0];
		} catch (error) {
			try {
				const fun = ("(" + data.toString() + ")").replace(/\{.*\}/, "{}");
				parsed = esprima.parse(fun).body[0];
			} catch (error) {
				return data
					.toString()
					.replace(/({).*(})/, "$1...$2")
					.replace(/^function\s+[\w_$\d]+\s*/, "")
					.replace(/\s*/g, "");
			}
		}

		if (parsed.type === "ExpressionStatement") {
			const expression = parsed.expression;
			if (expression.type === "ArrowFunctionExpression") {
				str = joinParams(expression.params, "arrow");
			} else if (expression.type === "FunctionExpression") {
				str = joinParams(expression.params);
			}
		} else {
			let string = parsed.id.name + joinParams(parsed.params || []);
			str = string;
		}

		function joinParams(params, type) {
			let parameter = "(";
			params.map(
				(param) =>
					(parameter +=
						param.type === "RestElement"
							? "..." + param.argument.name
							: param.name + ","),
			);
			parameter = parameter.replace(/,$/, "");
			parameter += ")" + (type === "arrow" ? "=>" : "") + "{...}";
			return parameter;
		}

		return str;
	}

	/**
	 * Prints to the console.
	 * @param {'log'|'error'|'warn'|'code'|'trace'|'table'} mode
	 * @param {{stack: string, location: string}} options
	 * @param  {...any} args
	 */
	function log(mode, options, ...args) {
		let location = options.location || "console";
		const $messages = tag("c-message", {
			attr: {
				"log-level": mode,
			},
		});

		args = format(args);

		if (args.length === 1 && args[0] instanceof Error) {
			args.unshift(args[0].message);
		}

		for (let arg of args) {
			const typeofArg = typeof arg;
			arg = arg ?? arg + "";

			let $msg;
			if (mode === "code") {
				$msg = tag("c-code");
				$msg.textContent = arg.length > 50 ? arg.substring(0, 50) + "..." : arg;
				$msg.setAttribute("data-code", arg);
				$msg.setAttribute("action", "use code");
			} else {
				$msg = getElement(typeofArg);

				switch (typeofArg) {
					case "object":
						$msg.append(...getBody(arg));
						break;
					case "function":
						$msg.innerHTML = parseFunction(arg);
						$msg.append(
							tag("c-line", {
								children: getBody(arg),
							}),
						);
						break;
					default:
						$msg.textContent = arg;
						break;
				}
			}
			$messages.appendChild($msg);
		}

		if (location) {
			const $stack = tag("c-stack");
			$stack.innerHTML = `<c-date>${new Date().toLocaleString()}</c-date><c-trace>${location}</c-trace>`;
			$messages.appendChild($stack);
		}

		$console.insertBefore($messages, $inputContainer);

		while ($console.childElementCount > 100) {
			$console.firstElementChild.remove();
		}
	}

	/**
	 *
	 * @param {Array<any>} args
	 * @returns
	 */
	function format(args) {
		if (args.length <= 1) return [args[0]];

		const originalArgs = [].concat(args);
		const styles = [];
		let msg = args.splice(0, 1)[0];

		if (typeof msg !== "string") return originalArgs;

		let matched = matchRegex(msg);
		let match;
		while ((match = matched.next())) {
			if (match.done) break;
			let value = "";
			const specifier = match.value[0];
			const pos = match.value.index;

			if (!args.length) {
				value = specifier;
			} else {
				value = args.splice(0, 1)[0];
				if ([undefined, null].includes(value)) {
					value = value + "";
				}

				switch (specifier) {
					case "%c":
						styles.push({
							value,
							pos,
						});
						value = "";
						break;
					case "%s":
						if (typeof value === "object") {
							value = value.constructor.name;
						}
						break;
					case "%o":
					case "%O":
						let id = new Date().getMilliseconds() + "";
						window.__objs[id] = value;
						value = `<c-object onclick='console.log(window.__objs[${id}])'>Object</c-object>`;
						break;
					case "%d":
					case "%i":
						value = Number.parseInt(value);
						break;
					case "%f":
						value = Number.parseFloat(value);
						break;
					default:
						break;
				}
			}
			// Only escape HTML for the %o/%O case where we're injecting actual HTML
			const escapedValue =
				specifier === "%o" || specifier === "%O" ? value : escapeHTML(value);
			msg = msg.substring(0, pos) + escapedValue + msg.substring(pos + 2);
			matched = matchRegex(msg);
		}

		if (styles.length) {
			const toBeStyled = [];
			let remainingMsg = msg;
			styles.reverse().forEach((style, i) => {
				toBeStyled.push(remainingMsg.substring(style.pos));
				remainingMsg = msg.substring(0, style.pos);
				if (i === styles.length - 1)
					toBeStyled.push(msg.substring(0, style.pos));
			});
			msg = toBeStyled
				.map((str, i) => {
					if (i === toBeStyled.length - 1) return str;
					const { value } = styles[i];
					return `<c-span style="${value}">${str}</c-span>`;
				})
				.reverse()
				.join("");
		}

		msg.replace(/%%[oOsdifc]/g, "%");

		args.unshift(msg);
		return args;

		/**
		 *
		 * @param {string} str
		 * @returns {IterableIterator<RegExpMatchArray>}
		 */
		function matchRegex(str) {
			return str.matchAll(/(?<!%)%[oOsdifc]/g);
		}
	}

	/**
	 * Gets the stack trace of the current call
	 * @param {Error} error
	 * @returns
	 */
	function getStack(error, skip = false) {
		if (error === null) {
			error = new Error();
		}
		let stack = error.stack.split("\n");
		if (!skip) stack.splice(1, 1);
		let regExecRes = /<(.*)>:(\d+):(\d+)/.exec(stack[1]) || [];
		if (!regExecRes.length) {
			const errorInfo = stack[1]?.split("/").pop();
			regExecRes = /(.+):(\d+):(\d+)/.exec(errorInfo) || [];
		}
		let src = "";
		const location = regExecRes[1];
		const lineno = regExecRes[2];
		const colno = regExecRes[3];

		if (location && lineno) {
			src = escapeHTML(`${location} ${lineno}${colno ? ":" + colno : ""}`);
		} else {
			const res = /\((.*)\)/.exec(stack[1]);
			src = res && res[1] ? res[1] : "";
		}
		const index = src.indexOf(")");
		src = src
			.split("/")
			.pop()
			.substring(0, index < 0 ? undefined : index);
		if (src.length > 50) src = "..." + src.substring(src.length - 50);

		return {
			location: src,
			stack: stack.join("\n"),
		};
	}

	function execute(code) {
		let res = null;
		try {
			const parsed = esprima.parse(code, {
				range: true,
			}).body;
			res = execParsedCode(parsed);
		} catch (e) {
			res = execParsedCode([]);
		}

		return res;

		function execParsedCode(parsed) {
			let extra = "";
			parsed.map((st) => {
				if (st.type === "VariableDeclaration") {
					if (["const", "let"].indexOf(st.kind) < 0) return;

					const range = st.range;
					const exCode = code.substring(range[0], range[1]) + ";";
					extra += exCode;
				}
			});

			if (extra) {
				const script = tag("script");
				script.textContent = extra;
				document.body.appendChild(script);
				document.body.removeChild(script);
				return exec(code);
			} else {
				return exec(code);
			}
		}

		function exec(code) {
			let res = null;
			try {
				res = { type: "result", value: window.eval(code) };
			} catch (error) {
				res = { type: "error", value: error };
			}

			return res;
		}
	}

	function onError(err) {
		const error = err.error;
		log("error", getStack(error, true), error);
	}

	function escapeHTML(str) {
		if (typeof str !== "string") return str;
		return tag("textarea", {
			textContent: str,
		}).innerHTML;
	}
})();
