interface QuickToolModifiers {
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	metaKey?: boolean;
}

interface QuickToolCommand {
	name: string;
	key?: string | null;
}

type ModifierName = "Ctrl" | "Alt" | "Shift" | "Meta";

const modifierAliases: Record<string, ModifierName> = {
	ctrl: "Ctrl",
	control: "Ctrl",
	alt: "Alt",
	option: "Alt",
	shift: "Shift",
	meta: "Meta",
	cmd: "Meta",
	command: "Meta",
	mod: "Ctrl",
};

const modifierOrder: ModifierName[] = ["Ctrl", "Alt", "Shift", "Meta"];

export function mapQuickToolShiftText(char: string | null | undefined): string {
	switch (char) {
		case "1":
			return "!";
		case "2":
			return "@";
		case "3":
			return "#";
		case "4":
			return "$";
		case "5":
			return "%";
		case "6":
			return "^";
		case "7":
			return "&";
		case "8":
			return "*";
		case "9":
			return "(";
		case "0":
			return ")";
		case "-":
			return "_";
		case "=":
			return "+";
		case "[":
			return "{";
		case "]":
			return "}";
		case "\\":
			return "|";
		case ";":
			return ":";
		case "'":
			return '"';
		case ",":
			return "<";
		case ".":
			return ">";
		case "/":
			return "?";
		default:
			return String(char ?? "").toUpperCase();
	}
}

export function getQuickToolCombo(
	key: string,
	modifiers: QuickToolModifiers = {},
): string | null {
	const normalizedKey = normalizeKey(key);
	if (!normalizedKey) return null;

	const modifierParts = Object.entries(modifiers)
		.filter(([, enabled]) => enabled)
		.map(([modifier]) => modifier.replace(/Key$/, ""));
	return normalizeShortcutCombo([...modifierParts, normalizedKey].join("-"));
}

export function findQuickToolCommand(
	commands: QuickToolCommand[],
	key: string,
	modifiers: QuickToolModifiers = {},
): QuickToolCommand | null {
	const combo = getQuickToolCombo(key, modifiers);
	if (!combo) return null;

	return (
		commands.find((command) =>
			getShortcutAlternatives(command.key).includes(combo),
		) || null
	);
}

export function getShortcutAlternatives(
	keyString: string | null | undefined,
): string[] {
	if (!keyString) return [];
	return String(keyString)
		.split("|")
		.map(normalizeShortcutCombo)
		.filter((combo): combo is string => Boolean(combo));
}

export function normalizeShortcutCombo(combo: string): string | null {
	if (!combo) return null;
	const parts = splitShortcutCombo(combo);
	const modifiers: ModifierName[] = [];
	let key: string | null = null;

	parts.forEach((part) => {
		const modifier = modifierAliases[part.toLowerCase()];
		if (modifier) {
			if (!modifiers.includes(modifier)) modifiers.push(modifier);
			return;
		}

		key = normalizeKey(part);
	});

	if (!key) return null;
	const orderedModifiers = modifierOrder.filter((modifier) =>
		modifiers.includes(modifier),
	);
	return [...orderedModifiers, key].join("-");
}

function splitShortcutCombo(combo: string): string[] {
	if (combo.endsWith("-")) {
		return [...combo.slice(0, -1).split("-").filter(Boolean), "-"];
	}
	return combo
		.split("-")
		.map((part) => part.trim())
		.filter(Boolean);
}

function normalizeKey(key: string | null | undefined): string | null {
	const text = String(key ?? "");
	if (!text) return null;
	if (text.length === 1 && /[a-z]/i.test(text)) return text.toUpperCase();
	return text;
}
