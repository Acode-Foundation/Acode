import { getModeForPath } from "cm/modelist";
import {
	BUILTIN_THEME_ID,
	createBuiltinTheme,
	SCHEMA_VERSION,
} from "./fileIconsBuiltin";

const THEME_ID_RE = /^[a-zA-Z][a-zA-Z0-9._-]*$/;
const UNSAFE_SRC_RE = /[\s"'()\\]/;

export type IconKind = "file" | "folder";
export type IconMatchSource =
	| "override"
	| "fileName"
	| "fileExtension"
	| "languageId"
	| "folderName"
	| "default";

export interface IconDefinition {
	className?: string;
	expandedClassName?: string;
	src?: string;
	expandedSrc?: string;
	light?: string;
	dark?: string;
	monochrome?: boolean;
	iconPath?: string;
}

export interface IconAssociations {
	fileNames?: Record<string, string>;
	fileExtensions?: Record<string, string>;
	languageIds?: Record<string, string>;
	folderNames?: Record<string, string>;
	folderNamesExpanded?: Record<string, string>;
}

export interface IconDefaults {
	file?: string;
	folder?: string;
	folderExpanded?: string;
	rootFolder?: string;
	rootFolderExpanded?: string;
}

/** VS Code / Zed-style icon theme. `icons` may be a folder URL of SVG files. */
export interface FileIconTheme extends IconAssociations, IconDefaults {
	id: string;
	name?: string;
	label?: string;
	schemaVersion?: number;
	pluginId?: string;
	baseUrl?: string;
	icons?: string | Record<string, IconDefinition | string>;
	iconDefinitions?: Record<string, IconDefinition | string>;
	associations?: IconAssociations;
	defaults?: IconDefaults;
}

export interface IconResource {
	kind?: IconKind;
	name: string;
	languageId?: string;
	expanded?: boolean;
	isRoot?: boolean;
	appearance?: "dark" | "light";
}

export interface IconHandle {
	className: string;
	iconId: string;
	source: IconMatchSource;
	kind: IconKind;
	themeId: string;
	expanded?: boolean;
}

export interface IconThemeInfo {
	id: string;
	label: string;
	available: boolean;
	pluginId: string | null;
}

export interface ActiveIconTheme {
	id: string;
	preferredId: string;
	label: string;
	available: boolean;
}

interface CompiledTheme {
	id: string;
	label: string;
	pluginId: string | null;
	schemaVersion: number;
	icons: Map<string, IconDefinition>;
	fileNames: Map<string, string>;
	fileNamesCi: Map<string, string>;
	fileExtensions: Map<string, string>;
	languageIds: Map<string, string>;
	folderNames: Map<string, string>;
	folderNamesExpanded: Map<string, string>;
	defaults: Required<IconDefaults>;
}

interface RegisterOptions {
	builtin?: boolean;
	pluginId?: string;
	silent?: boolean;
}

interface IconThemeSettings {
	value?: { iconTheme?: string };
	on?: (event: string, callback: (value: unknown) => void) => void;
	update?: (showToast?: boolean) => void;
}

interface OverrideRule {
	kind?: IconKind;
	name: string;
	icon: string;
	caseSensitive?: boolean;
}

type NormalizedResource = IconResource & { kind: IconKind; name: string };

function basename(value: unknown): string {
	const str = String(value ?? "");
	if (!str) return "";
	const trimmed =
		str.endsWith("/") || str.endsWith("\\") ? str.slice(0, -1) : str;
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

function sanitizeClassToken(value: unknown): string {
	return String(value ?? "")
		.trim()
		.replace(/[^a-zA-Z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function assertThemeId(id: unknown): string {
	if (typeof id !== "string" || !id.trim()) {
		throw new Error("Icon theme id is required");
	}
	if (!THEME_ID_RE.test(id)) {
		throw new Error(`Invalid icon theme id '${id}'`);
	}
	return id;
}

function isSafeSrc(src: unknown): src is string {
	if (typeof src !== "string") return false;
	const value = src.trim();
	if (!value || UNSAFE_SRC_RE.test(value)) return false;
	if (value.startsWith("data:image/")) return true;
	return (
		/^(https?:|blob:|file:|content:|ftp:)/i.test(value) || value.startsWith("/")
	);
}

function joinUrl(base: string, path: string): string {
	const rel = String(path || "").replace(/^\.\//, "");
	if (!base) return rel;
	return `${String(base).replace(/\/?$/, "/")}${rel.replace(/^\//, "")}`;
}

function resolveAssetPath(
	path: string,
	iconsDir: string | null,
	baseUrl?: string,
): string {
	const value = path.trim();
	if (!value) return "";
	if (
		/^(https?:|data:|blob:|file:|content:)/i.test(value) ||
		value.startsWith("/")
	) {
		return value;
	}
	return joinUrl(iconsDir || baseUrl || "", value);
}

function getDocument(): Document | null {
	return typeof document !== "undefined" ? document : null;
}

function inferLanguageId(filename: string): string | undefined {
	try {
		return getModeForPath?.(filename)?.name || undefined;
	} catch {
		return undefined;
	}
}

export function buildBuiltinFileClass(
	typeId: string,
	languageId?: string,
): string {
	const type = sanitizeClassToken(typeId) || "default";
	const mode = sanitizeClassToken(languageId || "text") || "text";
	return `file file_type_default file_type_${mode} file_type_${type}`;
}

export function buildBuiltinFolderClass(_folderId?: string): string {
	return "icon folder";
}

function iconIdFromAssoc(value: unknown): string {
	if (typeof value === "string") return value;
	if (
		value &&
		typeof value === "object" &&
		"icon" in value &&
		typeof value.icon === "string"
	) {
		return value.icon;
	}
	throw new Error("Association values must be icon ids");
}

function collectIconIds(theme: FileIconTheme): Set<string> {
	const ids = new Set<string>();
	const add = (value: unknown) => {
		if (typeof value === "string" && value) ids.add(value);
	};
	const addMap = (map?: Record<string, string>) => {
		if (!map) return;
		for (const value of Object.values(map)) add(value);
	};
	addMap(theme.fileNames);
	addMap(theme.fileExtensions);
	addMap(theme.languageIds);
	addMap(theme.folderNames);
	addMap(theme.folderNamesExpanded);
	addMap(theme.associations?.fileNames);
	addMap(theme.associations?.fileExtensions);
	addMap(theme.associations?.languageIds);
	addMap(theme.associations?.folderNames);
	addMap(theme.associations?.folderNamesExpanded);
	add(theme.file);
	add(theme.folder);
	add(theme.folderExpanded);
	add(theme.rootFolder);
	add(theme.rootFolderExpanded);
	add(theme.defaults?.file);
	add(theme.defaults?.folder);
	add(theme.defaults?.folderExpanded);
	add(theme.defaults?.rootFolder);
	add(theme.defaults?.rootFolderExpanded);
	return ids;
}

function folderIconIds(theme: FileIconTheme): Set<string> {
	const ids = new Set<string>();
	const add = (value?: string) => {
		if (value) ids.add(value);
	};
	const addMap = (map?: Record<string, string>) => {
		if (!map) return;
		for (const value of Object.values(map)) add(value);
	};
	addMap(theme.folderNames);
	addMap(theme.folderNamesExpanded);
	addMap(theme.associations?.folderNames);
	addMap(theme.associations?.folderNamesExpanded);
	add(theme.folder);
	add(theme.folderExpanded);
	add(theme.rootFolder);
	add(theme.rootFolderExpanded);
	add(theme.defaults?.folder);
	add(theme.defaults?.folderExpanded);
	add(theme.defaults?.rootFolder);
	add(theme.defaults?.rootFolderExpanded);
	return ids;
}

function fromVsCodeIcon(
	def: IconDefinition | string,
	iconsDir: string | null,
	baseUrl?: string,
): IconDefinition | string {
	if (typeof def === "string") {
		if (isSafeSrc(def)) return resolveAssetPath(def, iconsDir, baseUrl);
		return def;
	}
	const iconPath = def.iconPath || def.src;
	if (!iconPath) return def;
	const next: IconDefinition = {
		src: resolveAssetPath(iconPath, iconsDir, baseUrl),
	};
	if (def.expandedSrc) {
		next.expandedSrc = resolveAssetPath(def.expandedSrc, iconsDir, baseUrl);
	}
	if (def.light) next.light = resolveAssetPath(def.light, iconsDir, baseUrl);
	if (def.dark) next.dark = resolveAssetPath(def.dark, iconsDir, baseUrl);
	if (def.className) next.className = def.className;
	if (def.expandedClassName) next.expandedClassName = def.expandedClassName;
	if (def.monochrome) next.monochrome = true;
	return next;
}

export function prepareTheme(input: FileIconTheme): FileIconTheme {
	const theme: FileIconTheme = { ...input };
	if (typeof theme.name === "string" && !theme.label) {
		theme.label = theme.name;
	}

	let iconsDir: string | null = null;
	if (typeof theme.icons === "string") {
		iconsDir = theme.icons.replace(/\/?$/, "/");
		theme.icons = {};
	} else if (
		theme.icons &&
		typeof theme.icons === "object" &&
		!Array.isArray(theme.icons)
	) {
		theme.icons = { ...theme.icons };
	} else {
		theme.icons = {};
	}

	if (typeof theme.baseUrl === "string" && !iconsDir) {
		iconsDir = joinUrl(theme.baseUrl, "icons/");
	}

	const icons = theme.icons;
	if (theme.iconDefinitions) {
		for (const [id, def] of Object.entries(theme.iconDefinitions)) {
			icons[id] = fromVsCodeIcon(def, iconsDir, theme.baseUrl);
		}
	}

	const folders = folderIconIds(theme);
	for (const id of collectIconIds(theme)) {
		if (icons[id] || !iconsDir) continue;
		const def: IconDefinition = { src: joinUrl(iconsDir, `${id}.svg`) };
		if (
			!id.endsWith("-open") &&
			(id.startsWith("folder") || folders.has(id))
		) {
			def.expandedSrc = joinUrl(iconsDir, `${id}-open.svg`);
		}
		icons[id] = def;
	}

	return theme;
}

function normalizeAssocKey(key: string, kind: string): string {
	const value = String(key ?? "").trim();
	if (!value) throw new Error(`Empty ${kind} association`);
	if (kind === "fileExtension") return value.replace(/^\./, "").toLowerCase();
	if (kind === "languageId" || kind === "folderName") return value.toLowerCase();
	return value;
}

function addAssociations(
	map: Map<string, string>,
	source: Record<string, string> | undefined,
	kind: string,
	options: { caseInsensitive?: boolean } = {},
): void {
	if (!source) return;
	if (typeof source !== "object" || Array.isArray(source)) {
		throw new Error(`${kind} associations must be an object`);
	}
	for (const [rawKey, rawValue] of Object.entries(source)) {
		const key = options.caseInsensitive
			? normalizeAssocKey(rawKey, kind)
			: normalizeAssocKey(
					rawKey,
					kind === "fileExtension" ? "fileExtension" : "fileName",
				);
		map.set(key, iconIdFromAssoc(rawValue));
	}
}

function assetClassName(themeId: string, iconId: string, variant = ""): string {
	const suffix = variant ? `-${variant}` : "";
	return `file-icon--${sanitizeClassToken(themeId)}--${sanitizeClassToken(iconId)}${suffix}`;
}

function cssForSrc(
	className: string,
	src: string,
	monochrome: boolean,
): string {
	const host = `.icon.${className}{display:inline-flex;align-items:center;justify-content:center;background:none;}`;
	if (monochrome) {
		return `${host}.icon.${className}::before{content:'';display:block;width:1em;height:1em;-webkit-mask:url(${src}) no-repeat center / contain;mask:url(${src}) no-repeat center / contain;background-color:currentColor;}`;
	}
	return `${host}.icon.${className}::before{content:'';display:block;width:1em;height:1em;background:url(${src}) no-repeat center / contain;}`;
}

function normalizeIconDef(id: string, def: unknown): IconDefinition {
	if (typeof def === "string") {
		return isSafeSrc(def) ? { src: def.trim() } : { className: def };
	}
	if (!def || typeof def !== "object" || Array.isArray(def)) {
		throw new Error(`Invalid icon definition '${id}'`);
	}
	const rec = def as IconDefinition;
	const normalized: IconDefinition = {};
	if (typeof rec.className === "string" && rec.className.trim()) {
		normalized.className = rec.className.trim();
	}
	if (typeof rec.expandedClassName === "string" && rec.expandedClassName.trim()) {
		normalized.expandedClassName = rec.expandedClassName.trim();
	}
	for (const key of ["src", "expandedSrc", "light", "dark"] as const) {
		const value = rec[key];
		if (value == null) continue;
		if (!isSafeSrc(value)) {
			throw new Error(`Unsafe icon asset for '${id}.${key}'`);
		}
		normalized[key] = value.trim();
	}
	if (rec.monochrome) normalized.monochrome = true;
	if (
		!normalized.className &&
		!normalized.src &&
		!normalized.light &&
		!normalized.dark
	) {
		throw new Error(`Icon '${id}' needs className or src`);
	}
	return normalized;
}

function compileTheme(input: FileIconTheme): CompiledTheme {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Icon theme must be an object");
	}
	const theme = prepareTheme(input);
	const id = assertThemeId(theme.id);
	const schemaVersion = theme.schemaVersion ?? SCHEMA_VERSION;
	if (schemaVersion !== SCHEMA_VERSION) {
		throw new Error(
			`Unsupported icon theme schemaVersion ${schemaVersion} (expected ${SCHEMA_VERSION})`,
		);
	}

	const icons = new Map<string, IconDefinition>();
	if (theme.icons && typeof theme.icons === "object") {
		for (const [iconId, def] of Object.entries(theme.icons)) {
			if (!sanitizeClassToken(iconId)) throw new Error("Icon id is required");
			icons.set(iconId, normalizeIconDef(iconId, def));
		}
	}

	const associations = theme.associations || {};
	const fileNames = new Map<string, string>();
	const fileNamesCi = new Map<string, string>();
	const fileExtensions = new Map<string, string>();
	const languageIds = new Map<string, string>();
	const folderNames = new Map<string, string>();
	const folderNamesExpanded = new Map<string, string>();

	addAssociations(fileNames, theme.fileNames || associations.fileNames, "fileName");
	for (const [key, iconId] of fileNames) {
		const lower = key.toLowerCase();
		if (!fileNamesCi.has(lower)) fileNamesCi.set(lower, iconId);
	}
	addAssociations(
		fileExtensions,
		theme.fileExtensions || associations.fileExtensions,
		"fileExtension",
		{ caseInsensitive: true },
	);
	addAssociations(
		languageIds,
		theme.languageIds || associations.languageIds,
		"languageId",
		{ caseInsensitive: true },
	);
	addAssociations(
		folderNames,
		theme.folderNames || associations.folderNames,
		"folderName",
		{ caseInsensitive: true },
	);
	addAssociations(
		folderNamesExpanded,
		theme.folderNamesExpanded || associations.folderNamesExpanded,
		"folderName",
		{ caseInsensitive: true },
	);

	return {
		id,
		label: String(theme.label || theme.name || id),
		pluginId: theme.pluginId || null,
		schemaVersion,
		icons,
		fileNames,
		fileNamesCi,
		fileExtensions,
		languageIds,
		folderNames,
		folderNamesExpanded,
		defaults: {
			file: theme.defaults?.file || theme.file || "file",
			folder: theme.defaults?.folder || theme.folder || "folder",
			folderExpanded:
				theme.defaults?.folderExpanded || theme.folderExpanded || "folder",
			rootFolder: theme.defaults?.rootFolder || theme.rootFolder || "folder",
			rootFolderExpanded:
				theme.defaults?.rootFolderExpanded ||
				theme.rootFolderExpanded ||
				theme.defaults?.rootFolder ||
				theme.rootFolder ||
				"folder",
		},
	};
}

function matchExtension(
	name: string,
	extensions: Map<string, string>,
): string | undefined {
	const lower = name.toLowerCase();
	const parts = lower.split(".");
	if (parts.length < 2) return undefined;
	for (let i = 1; i < parts.length; i++) {
		const ext = parts.slice(i).join(".");
		if (ext && extensions.has(ext)) return extensions.get(ext);
	}
	return undefined;
}

function lastExtension(name: string): string {
	const lower = name.toLowerCase();
	if (lower.startsWith(".") && lower.indexOf(".", 1) === -1) return "";
	const parts = lower.split(".");
	if (parts.length < 2) return "";
	return parts[parts.length - 1] || "";
}

class FileIconRegistry {
	#themes = new Map<string, FileIconTheme>();
	#compiled = new Map<string, CompiledTheme>();
	#overrides = new Map<string, OverrideRule>();
	#listeners = new Set<(info: { activeId: string; preferredId: string }) => void>();
	#activeId = BUILTIN_THEME_ID;
	#preferredId = BUILTIN_THEME_ID;
	#settings: IconThemeSettings | null = null;

	constructor() {
		this.#putTheme(createBuiltinTheme() as FileIconTheme, {
			builtin: true,
			silent: true,
		});
		this.#activeId = BUILTIN_THEME_ID;
		this.#preferredId = BUILTIN_THEME_ID;
	}

	bindSettings(settings: IconThemeSettings): void {
		this.#settings = settings;
		settings?.on?.("update:iconTheme", (value) => {
			this.use(typeof value === "string" ? value : BUILTIN_THEME_ID, {
				persist: false,
			});
		});
	}

	syncFromSettings(): void {
		const id = this.#settings?.value?.iconTheme;
		if (typeof id === "string" && id) this.use(id, { persist: false });
	}

	/**
	 * Register or replace an icon theme. If `icons` is a folder URL, referenced
	 * ids resolve to `<icons>/<id>.svg` (and `<id>-open.svg` for folders).
	 */
	register(theme: FileIconTheme, options: RegisterOptions = {}): { dispose: () => void } {
		const compiled = compileTheme(theme);
		if (compiled.id === BUILTIN_THEME_ID && !options.builtin) {
			throw new Error("Cannot replace the built-in icon theme");
		}
		if (this.#themes.has(compiled.id) && compiled.id !== BUILTIN_THEME_ID) {
			this.update(compiled.id, theme);
			return { dispose: () => this.unregister(compiled.id) };
		}
		this.#putTheme(theme, options);
		return { dispose: () => this.unregister(compiled.id) };
	}

	/** @deprecated Use register() */
	registerTheme(theme: FileIconTheme, options: RegisterOptions = {}) {
		return this.register(theme, options);
	}

	update(id: string, theme: FileIconTheme): void {
		if (id === BUILTIN_THEME_ID) {
			throw new Error("Cannot update the built-in icon theme");
		}
		if (!this.#themes.has(id)) {
			throw new Error(`Icon theme '${id}' is not registered`);
		}
		const previous = this.#compiled.get(id);
		this.#putTheme(
			{
				...theme,
				id,
				pluginId: theme.pluginId || previous?.pluginId || undefined,
			},
			{},
		);
	}

	/** @deprecated Use update() */
	updateTheme(id: string, theme: FileIconTheme): void {
		this.update(id, theme);
	}

	unregister(id: string): boolean {
		if (id === BUILTIN_THEME_ID) return false;
		if (!this.#themes.has(id)) return false;
		this.#themes.delete(id);
		this.#compiled.delete(id);
		this.#removeThemeStyles(id);
		if (this.#activeId === id) {
			this.#activeId = BUILTIN_THEME_ID;
			this.#emitChange();
		}
		return true;
	}

	/** @deprecated Use unregister() */
	unregisterTheme(id: string): boolean {
		return this.unregister(id);
	}

	unregisterByPlugin(pluginId: string): void {
		if (!pluginId) return;
		for (const [id, compiled] of [...this.#compiled]) {
			if (compiled.pluginId === pluginId) this.unregister(id);
		}
	}

	list(): IconThemeInfo[] {
		const list: IconThemeInfo[] = [];
		for (const compiled of this.#compiled.values()) {
			list.push({
				id: compiled.id,
				label: compiled.label,
				available: true,
				pluginId: compiled.pluginId,
			});
		}
		if (this.#preferredId && !this.#compiled.has(this.#preferredId)) {
			list.push({
				id: this.#preferredId,
				label: this.#preferredId,
				available: false,
				pluginId: null,
			});
		}
		return list;
	}

	/** @deprecated Use list() */
	listThemes(): IconThemeInfo[] {
		return this.list();
	}

	active(): ActiveIconTheme {
		const compiled = this.#compiled.get(this.#activeId);
		return {
			id: this.#activeId,
			preferredId: this.#preferredId,
			label: compiled?.label || this.#activeId,
			available: this.#compiled.has(this.#preferredId),
		};
	}

	/** @deprecated Use active() */
	getActiveTheme(): ActiveIconTheme {
		return this.active();
	}

	use(id: string, options: { persist?: boolean } = {}): ActiveIconTheme {
		const next =
			typeof id === "string" && id.trim() ? id.trim() : BUILTIN_THEME_ID;
		const persist = options.persist !== false;
		const preferredChanged = next !== this.#preferredId;
		this.#preferredId = next;
		const resolved = this.#compiled.has(next) ? next : BUILTIN_THEME_ID;
		const activeChanged = resolved !== this.#activeId;
		this.#activeId = resolved;
		if (persist) this.#persistPreferred(next);
		if (preferredChanged || activeChanged) this.#emitChange();
		return this.active();
	}

	/** @deprecated Use use() */
	setPreferredTheme(id: string, options: { persist?: boolean } = {}) {
		return this.use(id, options);
	}

	/** @deprecated Use use() */
	setActiveTheme(id: string) {
		return this.use(id);
	}

	setOverride(rule: OverrideRule): { dispose: () => void } {
		if (!rule || typeof rule.name !== "string" || !rule.name) {
			throw new Error("Override name is required");
		}
		const kind = rule.kind === "folder" ? "folder" : "file";
		this.#overrides.set(overrideKey(kind, rule.name, rule.caseSensitive !== false), {
			icon: String(rule.icon || ""),
			kind,
			name: rule.name,
			caseSensitive: rule.caseSensitive !== false,
		});
		this.#emitChange();
		return { dispose: () => this.removeOverride(rule) };
	}

	removeOverride(rule: Pick<OverrideRule, "kind" | "name" | "caseSensitive">): boolean {
		if (!rule?.name) return false;
		const kind = rule.kind === "folder" ? "folder" : "file";
		return this.#overrides.delete(
			overrideKey(kind, rule.name, rule.caseSensitive !== false),
		);
	}

	resolve(resource: IconResource | string): IconHandle {
		const input = normalizeResource(resource);
		const compiled =
			this.#compiled.get(this.#activeId) ||
			this.#compiled.get(BUILTIN_THEME_ID);
		const builtin = this.#compiled.get(BUILTIN_THEME_ID);
		if (!compiled || !builtin) {
			return {
				className: buildBuiltinFileClass("default"),
				iconId: "default",
				source: "default",
				kind: input.kind,
				themeId: BUILTIN_THEME_ID,
			};
		}
		const languageId = input.languageId || inferLanguageId(input.name);
		if (input.kind === "folder") {
			return this.#resolveFolder(input, compiled, builtin);
		}
		return this.#resolveFile(input, compiled, builtin, languageId);
	}

	resolveMany(resources: Array<IconResource | string>): IconHandle[] {
		if (!Array.isArray(resources)) return [];
		return resources.map((resource) => this.resolve(resource));
	}

	icon(resource: IconResource | string): string {
		return this.resolve(resource).className;
	}

	getIconClass(resource: IconResource | string): string {
		return this.icon(resource);
	}

	onChange(
		listener: (info: { activeId: string; preferredId: string }) => void,
	): () => void {
		if (typeof listener !== "function") return () => {};
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	onDidChange(
		listener: (info: { activeId: string; preferredId: string }) => void,
	): () => void {
		return this.onChange(listener);
	}

	refreshRenderedIcons(): void {
		const doc = getDocument();
		if (!doc) return;

		const apply = () => {
			for (const $tile of doc.querySelectorAll<HTMLElement>(
				'[data-type="file"][data-name]',
			)) {
				applyLeadClass(
					$tile,
					this.icon({ kind: "file", name: $tile.dataset.name || "" }),
				);
			}

			for (const $tile of doc.querySelectorAll<HTMLElement>(
				'[data-type="dir"][data-name], [data-type="root"][data-name]',
			)) {
				const expanded = !$tile
					.closest(".collapsible")
					?.classList.contains("hidden");
				applyLeadClass(
					$tile,
					this.icon({
						kind: "folder",
						name: $tile.dataset.name || "",
						expanded,
						isRoot: $tile.dataset.type === "root",
					}),
				);
			}

			this.#refreshEditorTabs();
		};

		apply();
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(apply);
		}
	}

	resetForTests(): void {
		for (const id of [...this.#themes.keys()]) {
			if (id !== BUILTIN_THEME_ID) this.unregister(id);
		}
		this.#overrides.clear();
		this.#listeners.clear();
		this.#preferredId = BUILTIN_THEME_ID;
		this.#activeId = BUILTIN_THEME_ID;
		this.#settings = null;
	}

	#putTheme(theme: FileIconTheme, options: RegisterOptions): CompiledTheme {
		const compiled = compileTheme(theme);
		if (options.pluginId && !compiled.pluginId) {
			compiled.pluginId = options.pluginId;
		}
		this.#themes.set(compiled.id, { ...theme, pluginId: compiled.pluginId || undefined });
		this.#compiled.set(compiled.id, compiled);
		this.#applyThemeStyles(compiled);

		const becameActive =
			compiled.id === this.#preferredId && this.#activeId !== compiled.id;
		if (becameActive) this.#activeId = compiled.id;
		if (!options.silent && (becameActive || compiled.id === this.#activeId)) {
			this.#emitChange();
		}
		return compiled;
	}

	#persistPreferred(id: string): void {
		if (!this.#settings?.value) return;
		if (this.#settings.value.iconTheme === id) return;
		this.#settings.value.iconTheme = id;
		this.#settings.update?.(false);
	}

	#emitChange(): void {
		const info = { activeId: this.#activeId, preferredId: this.#preferredId };
		for (const listener of this.#listeners) {
			try {
				listener(info);
			} catch (error) {
				console.warn("[fileIcons] onChange listener failed:", error);
			}
		}
		this.refreshRenderedIcons();
	}

	#refreshEditorTabs(): void {
		const files =
			typeof window !== "undefined"
				? (
						window as unknown as {
							editorManager?: {
								files?: Array<{
									tab?: HTMLElement;
									filename?: string;
									type?: string;
								}>;
							};
						}
					).editorManager?.files
				: null;
		if (!Array.isArray(files)) return;
		for (const file of files) {
			const $tab = file?.tab;
			if (!$tab || !file.filename) continue;
			const $lead = $tab.firstElementChild;
			if (
				!$lead ||
				$lead.classList.contains("text") ||
				$lead.classList.contains("cancel")
			) {
				continue;
			}
			if (file.type && file.type !== "editor") continue;
			$lead.className = this.icon({ kind: "file", name: file.filename });
		}
	}

	#resolveFile(
		input: NormalizedResource,
		compiled: CompiledTheme,
		builtin: CompiledTheme,
		languageId?: string,
	): IconHandle {
		const name = input.name;
		const override = this.#matchOverride("file", name);
		if (override) {
			return this.#handleFromIcon(
				compiled,
				builtin,
				override.icon,
				"override",
				input,
				languageId,
			);
		}

		const exact = compiled.fileNames.get(name);
		if (exact) {
			return this.#handleFromIcon(
				compiled,
				builtin,
				exact,
				"fileName",
				input,
				languageId,
			);
		}
		const ci = compiled.fileNamesCi.get(name.toLowerCase());
		if (ci) {
			return this.#handleFromIcon(
				compiled,
				builtin,
				ci,
				"fileName",
				input,
				languageId,
			);
		}

		const byExt = matchExtension(name, compiled.fileExtensions);
		if (byExt) {
			return this.#handleFromIcon(
				compiled,
				builtin,
				byExt,
				"fileExtension",
				input,
				languageId,
			);
		}

		const langKey = languageId ? languageId.toLowerCase() : "";
		if (langKey && compiled.languageIds.has(langKey)) {
			return this.#handleFromIcon(
				compiled,
				builtin,
				compiled.languageIds.get(langKey) || "",
				"languageId",
				input,
				languageId,
			);
		}

		if (compiled.id === BUILTIN_THEME_ID) {
			const ext = lastExtension(name);
			const typeId = ext || "default";
			return {
				className: buildBuiltinFileClass(typeId, languageId),
				iconId: typeId,
				source: ext ? "fileExtension" : "default",
				kind: "file",
				themeId: compiled.id,
			};
		}

		return this.#handleFromIcon(
			compiled,
			builtin,
			compiled.defaults.file || "file",
			"default",
			input,
			languageId,
		);
	}

	#resolveFolder(
		input: NormalizedResource,
		compiled: CompiledTheme,
		builtin: CompiledTheme,
	): IconHandle {
		const override = this.#matchOverride("folder", input.name);
		if (override) {
			return this.#handleFromIcon(
				compiled,
				builtin,
				override.icon,
				"override",
				input,
			);
		}

		const key = input.name.toLowerCase();
		if (input.expanded && compiled.folderNamesExpanded.has(key)) {
			return this.#handleFromIcon(
				compiled,
				builtin,
				compiled.folderNamesExpanded.get(key) || "",
				"folderName",
				input,
			);
		}
		if (compiled.folderNames.has(key)) {
			return this.#handleFromIcon(
				compiled,
				builtin,
				compiled.folderNames.get(key) || "",
				"folderName",
				input,
			);
		}

		let defaultId = compiled.defaults.folder || "folder";
		if (input.isRoot) {
			defaultId = input.expanded
				? compiled.defaults.rootFolderExpanded || defaultId
				: compiled.defaults.rootFolder || defaultId;
		} else if (input.expanded) {
			defaultId = compiled.defaults.folderExpanded || defaultId;
		}

		return this.#handleFromIcon(compiled, builtin, defaultId, "default", input);
	}

	#matchOverride(kind: IconKind, name: string): OverrideRule | undefined {
		return (
			this.#overrides.get(overrideKey(kind, name, true)) ||
			this.#overrides.get(overrideKey(kind, name, false))
		);
	}

	#handleFromIcon(
		compiled: CompiledTheme,
		builtin: CompiledTheme,
		iconId: string,
		source: IconMatchSource,
		input: NormalizedResource,
		languageId?: string,
	): IconHandle {
		const def = compiled.icons.get(iconId);
		const className = this.#classNameFor(
			compiled,
			def,
			iconId,
			input,
			languageId,
		);
		if (className) {
			return {
				className,
				iconId,
				source,
				kind: input.kind,
				themeId: compiled.id,
				expanded: input.expanded,
			};
		}

		if (compiled.id !== BUILTIN_THEME_ID && source !== "default") {
			const fallbackId =
				input.kind === "folder"
					? input.expanded
						? compiled.defaults.folderExpanded || "folder"
						: compiled.defaults.folder || "folder"
					: compiled.defaults.file || "file";
			return this.#handleFromIcon(
				compiled,
				builtin,
				fallbackId,
				"default",
				input,
				languageId,
			);
		}

		if (compiled.id !== BUILTIN_THEME_ID) {
			return this.#handleFromIcon(
				builtin,
				builtin,
				input.kind === "folder" ? "folder" : "file",
				"default",
				input,
				languageId,
			);
		}

		return {
			className:
				input.kind === "folder"
					? buildBuiltinFolderClass()
					: buildBuiltinFileClass("default", languageId),
			iconId: iconId || "default",
			source,
			kind: input.kind,
			themeId: BUILTIN_THEME_ID,
			expanded: input.expanded,
		};
	}

	#classNameFor(
		compiled: CompiledTheme,
		def: IconDefinition | undefined,
		iconId: string,
		input: NormalizedResource,
		languageId?: string,
	): string {
		if (def) {
			if (input.kind === "folder" && input.expanded) {
				if (def.expandedClassName) return def.expandedClassName;
				if (def.expandedSrc) {
					return `icon ${assetClassName(compiled.id, iconId, "expanded")}`;
				}
			}
			if (def.className) return def.className;
			if (def.src || def.light || def.dark) {
				return `icon ${assetClassName(compiled.id, iconId)}`;
			}
		}

		if (compiled.id === BUILTIN_THEME_ID) {
			if (input.kind === "folder") return buildBuiltinFolderClass();
			if (iconId === "file") return buildBuiltinFileClass("default", languageId);
			return buildBuiltinFileClass(iconId, languageId);
		}

		return "";
	}

	#applyThemeStyles(compiled: CompiledTheme): void {
		const doc = getDocument();
		if (!doc) return;

		const rules: string[] = [];
		for (const [iconId, def] of compiled.icons) {
			const src = pickSrc(def);
			if (src) {
				rules.push(
					cssForSrc(assetClassName(compiled.id, iconId), src, !!def.monochrome),
				);
			}
			if (def.expandedSrc) {
				rules.push(
					cssForSrc(
						assetClassName(compiled.id, iconId, "expanded"),
						def.expandedSrc,
						!!def.monochrome,
					),
				);
			}
		}

		let style = doc.head.querySelector(`style[data-file-icon="${compiled.id}"]`);
		if (!rules.length) {
			style?.remove();
			return;
		}
		if (!style) {
			style = doc.createElement("style");
			style.setAttribute("data-file-icon", compiled.id);
			doc.head.appendChild(style);
		}
		style.textContent = rules.join("\n");
	}

	#removeThemeStyles(id: string): void {
		getDocument()
			?.head.querySelector(`style[data-file-icon="${id}"]`)
			?.remove();
	}
}

function overrideKey(
	kind: IconKind,
	name: string,
	caseSensitive: boolean,
): string {
	return `${kind}:${caseSensitive ? name : name.toLowerCase()}`;
}

function normalizeResource(resource: IconResource | string): NormalizedResource {
	if (typeof resource === "string") {
		return { kind: "file", name: basename(resource) };
	}
	const kind = resource?.kind === "folder" ? "folder" : "file";
	return {
		...resource,
		kind,
		name: basename(resource?.name || ""),
	};
}

function applyLeadClass($tile: HTMLElement, className: string): void {
	const $lead =
		$tile.querySelector<HTMLElement>(":scope > span:first-child") ||
		($tile.firstElementChild as HTMLElement | null);
	if (!$lead || $lead.classList.contains("text") || $lead.classList.contains("tail")) {
		return;
	}
	$lead.className = className;
}

function pickSrc(def: IconDefinition, appearance?: "dark" | "light"): string {
	if (appearance === "light" && def.light) return def.light;
	if (appearance === "dark" && def.dark) return def.dark;
	return def.src || def.dark || def.light || "";
}

const fileIcons = new FileIconRegistry();

export { BUILTIN_THEME_ID, SCHEMA_VERSION };
export default fileIcons;
