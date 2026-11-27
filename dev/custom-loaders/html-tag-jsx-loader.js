/**
 * Custom loader that transforms JSX to html-tag-js tag() calls
 * This uses Babel's parser/transformer but is lighter than full babel-loader
 */
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");

module.exports = function htmlTagJsxLoader(source) {
	const callback = this.async();

	// Enable caching for this loader
	this.cacheable && this.cacheable();

	try {
		// Debug logging - verify loader is running
		// console.log(`🔧 Custom JSX loader processing: ${this.resourcePath}\n`);

		// Determine file type from extension
		const isTypeScript = /\.tsx?$/.test(this.resourcePath);

		// Quick check: if no JSX syntax at all, pass through unchanged
		// Look for complete JSX opening tags with proper spacing
		const hasJSXLike =
			/<\/?[A-Z][a-zA-Z0-9]*[^>]*>|<\/?[a-z][a-z0-9-]*[^>]*>/.test(source);

		if (!hasJSXLike) {
			return callback(null, source);
		}

		// Parse with appropriate plugins
		const parserPlugins = ["jsx"];
		if (isTypeScript) {
			parserPlugins.push("typescript");
		}

		const ast = parse(source, {
			sourceType: "module",
			plugins: parserPlugins,
		});

		// Track if we need to add the import
		let needsTagImport = false;
		let hasJSX = false;
		const hasExistingImport =
			/import\s+(?:\{[^}]*\btag\b[^}]*\}|tag(?:\s+as\s+\w+)?)\s+from\s+['"]html-tag-js['"]/.test(
				source,
			) ||
			/(?:const|let|var)\s+(?:\{[^}]*\btag\b[^}]*\}|tag)\s*=\s*require\s*\(\s*['"]html-tag-js['"]\s*\)/.test(
				source,
			);

		// Transform JSX elements
		traverse(ast, {
			JSXFragment(path) {
				hasJSX = true;
				needsTagImport = true;
				const { node } = path;
				const { children: childrenNode } = node;

				const children = [];
				populateChildren(childrenNode, children, t);
				const arrayExpression = t.arrayExpression(children);
				path.replaceWith(arrayExpression);
			},

			JSXElement(path) {
				hasJSX = true;
				needsTagImport = true;
				const { node } = path;
				const { openingElement: el, children: childrenNode } = node;

				let { name: tagName } = el.name;
				const { attributes } = el;

				let id;
				let className;
				const on = [];
				const args = [];
				const attrs = [];
				const children = [];
				const options = [];
				const events = {};
				let isComponent =
					/^(?:[A-Z][a-zA-Z0-9_$]*|(?:[a-zA-Z_$][a-zA-Z0-9_$]*\.)+[a-zA-Z_$][a-zA-Z0-9_$]*)$/.test(
						tagName,
					);

				if (el.name.type === "JSXMemberExpression") {
					const { object, property } = el.name;
					tagName = `${object.name}.${property.name}`;
					isComponent = true;
				}

				populateChildren(childrenNode, children, t);

				for (const attr of attributes) {
					if (attr.type === "JSXSpreadAttribute") {
						if (isComponent) {
							attrs.push(t.spreadElement(attr.argument));
						} else {
							options.push(t.spreadElement(attr.argument));
						}
						continue;
					}

					let { name, namespace } = attr.name;

					if (!isComponent) {
						if (name === "id") {
							if (attr.value && attr.value.type === "StringLiteral") {
								id = attr.value;
							} else if (
								attr.value &&
								attr.value.type === "JSXExpressionContainer"
							) {
								id = attr.value.expression;
							}
							continue;
						}

						if (["class", "className"].includes(name)) {
							if (attr.value && attr.value.type === "StringLiteral") {
								className = attr.value;
							} else if (
								attr.value &&
								attr.value.type === "JSXExpressionContainer"
							) {
								className = attr.value.expression;
							}
							continue;
						}
					}

					if (namespace) {
						namespace = namespace.name;
						name = name.name;
					}

					if (!attr.value) {
						attrs.push(
							t.objectProperty(t.stringLiteral(name), t.stringLiteral("")),
						);
						continue;
					}

					const { type } = attr.value;
					const isAttr = /-/.test(name);
					let value;

					if (type === "StringLiteral") {
						value = attr.value;
					} else {
						value = attr.value.expression;
					}

					if (namespace) {
						if (!["on", "once", "off"].includes(namespace)) {
							attrs.push(
								t.objectProperty(
									t.stringLiteral(
										namespace === "attr" ? name : `${namespace}:${name}`,
									),
									value,
								),
							);
							continue;
						}

						if (namespace === "off") continue;

						if (!events[name]) {
							events[name] = [];
							on.push(
								t.objectProperty(
									t.stringLiteral(name),
									t.arrayExpression(events[name]),
								),
							);
						}

						events[name].push(value);
						continue;
					}

					if (isAttr) {
						const attrRegex = /^attr-(.+)/;
						if (attrRegex.test(name)) {
							[, name] = attrRegex.exec(name);
						}

						attrs.push(t.objectProperty(t.stringLiteral(name), value));
						continue;
					}

					(isComponent ? attrs : options).unshift(
						t.objectProperty(t.identifier(name), value),
					);
				}

				if (isComponent) {
					args.push(t.identifier(tagName));

					if (on.length > 0) {
						attrs.push(
							t.objectProperty(t.identifier("on"), t.objectExpression(on)),
						);
					}

					if (attrs.length > 0) {
						args.push(t.objectExpression(attrs));
					}

					if (children.length > 0) {
						args.push(t.arrayExpression(children));
					}
				} else {
					args.push(t.stringLiteral(tagName));

					if (on.length > 0) {
						options.push(
							t.objectProperty(t.identifier("on"), t.objectExpression(on)),
						);
					}

					if (attrs.length > 0) {
						options.push(
							t.objectProperty(t.identifier("attr"), t.objectExpression(attrs)),
						);
					}

					if (id || className) {
						if (className) {
							args.push(className);
						} else {
							args.push(t.nullLiteral());
						}

						if (id) {
							args.push(id);
						} else if (className) {
							// Push null for id when we have className but no id
							args.push(t.nullLiteral());
						}
					}

					if (children.length) {
						args.push(t.arrayExpression(children));
					}

					if (options.length) {
						args.push(t.objectExpression(options));
					}
				}

				const identifier = t.identifier("tag");
				const callExpression = t.callExpression(identifier, args);
				path.replaceWith(callExpression);
			},
		});

		// If no JSX was found, return original source
		if (!hasJSX) {
			return callback(null, source);
		}

		// Generate the transformed code
		const output = generate(
			ast,
			{
				sourceMaps: true,
				sourceFileName: this.resourcePath,
				retainLines: false,
				compact: false,
			},
			source,
		);

		// Add import if needed
		if (needsTagImport && !hasExistingImport) {
			output.code = `import tag from 'html-tag-js';\n${output.code}`;
		}

		callback(null, output.code, output.map);
	} catch (error) {
		const errorMessage = `html-tag-jsx-loader failed to process ${this.resourcePath}: ${error.message}`;
		const enhancedError = new Error(errorMessage);
		enhancedError.stack = error.stack;
		callback(enhancedError);
	}
};

/**
 * Parse node to expression
 */
function parseNode(types, node) {
	const { type } = node;
	if (type === "JSXText") {
		const trimmed = node.value.trim();
		if (!trimmed) return null;
		// Preserve original text if it contains non-whitespace
		// This maintains intentional spacing like "Hello " in <span>Hello </span>
		return types.stringLiteral(node.value);
	}

	if (type === "JSXElement") {
		return node;
	}

	const { expression } = node;
	const invalidExpressions = ["JSXEmptyExpression"];

	if (invalidExpressions.includes(expression.type)) {
		return null;
	}

	return expression;
}

/**
 * Populate children
 */
function populateChildren(childrenNode, children, t) {
	for (let node of childrenNode) {
		node = parseNode(t, node);
		if (!node) continue;
		children.push(node);
	}
}
