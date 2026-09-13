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
	| "fileName"
	| "fileExtension"
	| "languageId"
	| "folderName"
	| "default";

export type IconDefinition =
	| { src: string; monochrome?: boolean; className?: never }
	| { className: string; src?: never; monochrome?: never };

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
	schemaVersion?: number;
	pluginId: string;
	icons?: string | Record<string, IconDefinition>;
}

export interface IconResource {
	kind?: IconKind;
	name: string;
	languageId?: string;
	expanded?: boolean;
	isRoot?: boolean;
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
	name: string;
	available: boolean;
	pluginId: string | null;
}

export interface ActiveIconTheme {
	id: string;
	preferredId: string;
	name: string;
	available: boolean;
}

interface CompiledTheme {
	id: string;
	name: string;
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

interface IconThemeSettings {
	value?: { iconTheme?: string };
	on?: (event: string, callback: (value: unknown) => void) => void;
	update?: (showToast?: boolean) => void;
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

const ASSOCIATION_FIELDS = [
	"fileNames",
	"fileExtensions",
	"languageIds",
	"folderNames",
	"folderNamesExpanded",
] as const;
const DEFAULT_FIELDS = [
	"file",
	"folder",
	"folderExpanded",
	"rootFolder",
	"rootFolderExpanded",
] as const;
const THEME_FIELDS = new Set<string>([
	"id",
	"name",
	"schemaVersion",
	"pluginId",
	"icons",
	...ASSOCIATION_FIELDS,
	...DEFAULT_FIELDS,
]);

function assertFields(value: object, allowed: Set<string>, path: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new Error(`${path}.${key} is not supported`);
	}
}

function iconIdFromAssoc(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error("Association values must be non-empty icon ids");
	}
	return value;
}

type ThemeInput = Omit<FileIconTheme, "pluginId"> & { pluginId?: string };

function prepareTheme(input: ThemeInput): ThemeInput {
	assertFields(input, THEME_FIELDS, "theme");
	if (typeof input.icons !== "string") return input;
	const icons: Record<string, IconDefinition> = Object.create(null);
	const add = (value: unknown) => {
		const id = iconIdFromAssoc(value);
		if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
			throw new Error(
				`Icon id '${id}' must use letters, digits, underscores or hyphens with an icons directory`,
			);
		}
		icons[id] = { src: joinUrl(input.icons as string, `${id}.svg`) };
	};
	for (const field of ASSOCIATION_FIELDS) {
		if (input[field])
			for (const value of Object.values(input[field]!)) add(value);
	}
	for (const field of DEFAULT_FIELDS) if (input[field]) add(input[field]);
	return { ...input, icons };
}

function normalizeAssocKey(key: string, kind: string): string {
	const value = String(key ?? "");
	if (!value) throw new Error(`Empty ${kind} association`);
	if (kind === "fileExtension") {
		if (
			value.startsWith(".") ||
			value.endsWith(".") ||
			value.includes("..") ||
			/[\s/\\]/.test(value)
		)
			throw new Error(
				`Invalid fileExtension '${key}'; omit leading dots and paths`,
			);
		return value.toLowerCase();
	}
	if (kind === "languageId" || kind === "folderName")
		return value.toLowerCase();
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
		const iconId = iconIdFromAssoc(rawValue);
		if (map.has(key) && map.get(key) !== iconId) {
			throw new Error(
				`Conflicting ${kind} association '${rawKey}' (normalized to '${key}')`,
			);
		}
		map.set(key, iconId);
	}
}

function assetClassName(themeId: string, iconId: string): string {
	const encode = (value: string) =>
		Array.from(value, (char) => char.codePointAt(0)!.toString(16)).join("_");
	return `file-icon--${encode(themeId)}--${encode(iconId)}`;
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
	if (!def || typeof def !== "object" || Array.isArray(def)) {
		throw new Error(`icons.${id} must be an object with src or className`);
	}
	assertFields(def, new Set(["src", "className", "monochrome"]), `icons.${id}`);
	const rec = def as IconDefinition;
	if (!!rec.src === !!rec.className)
		throw new Error(`icons.${id} needs exactly one of src or className`);
	if (rec.src && !isSafeSrc(rec.src))
		throw new Error(`Unsafe icon asset for 'icons.${id}.src'`);
	if (
		rec.className &&
		(typeof rec.className !== "string" || !rec.className.trim())
	) {
		throw new Error(`icons.${id}.className must be a non-empty string`);
	}
	if (
		rec.monochrome !== undefined &&
		(typeof rec.monochrome !== "boolean" || !rec.src)
	) {
		throw new Error(
			`icons.${id}.monochrome requires src and must be a boolean`,
		);
	}
	return rec.src
		? { src: rec.src.trim(), monochrome: rec.monochrome }
		: { className: rec.className!.trim() };
}

function compileTheme(input: ThemeInput): CompiledTheme {
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

	const fileNames = new Map<string, string>();
	const fileNamesCi = new Map<string, string>();
	const fileExtensions = new Map<string, string>();
	const languageIds = new Map<string, string>();
	const folderNames = new Map<string, string>();
	const folderNamesExpanded = new Map<string, string>();

	addAssociations(fileNames, theme.fileNames, "fileName");
	for (const [key, iconId] of fileNames) {
		const lower = key.toLowerCase();
		if (fileNamesCi.has(lower) && fileNamesCi.get(lower) !== iconId)
			throw new Error(`Conflicting fileName association '${key}'`);
		fileNamesCi.set(lower, iconId);
	}
	addAssociations(fileExtensions, theme.fileExtensions, "fileExtension", {
		caseInsensitive: true,
	});
	addAssociations(languageIds, theme.languageIds, "languageId", {
		caseInsensitive: true,
	});
	addAssociations(folderNames, theme.folderNames, "folderName", {
		caseInsensitive: true,
	});
	addAssociations(
		folderNamesExpanded,
		theme.folderNamesExpanded,
		"folderName",
		{ caseInsensitive: true },
	);

	if (id !== BUILTIN_THEME_ID) {
		if (typeof theme.pluginId !== "string" || !theme.pluginId.trim())
			throw new Error("theme.pluginId is required");
		if (
			theme.icons !== undefined &&
			(!theme.icons ||
				typeof theme.icons !== "object" ||
				Array.isArray(theme.icons))
		)
			throw new Error("theme.icons must be a directory URL or definition map");
		for (const field of ASSOCIATION_FIELDS) {
			for (const [key, iconId] of Object.entries(theme[field] || {})) {
				if (!icons.has(iconId))
					throw new Error(
						`${field}.${key} references unknown icon '${iconId}'`,
					);
			}
		}
		for (const field of DEFAULT_FIELDS) {
			if (theme[field] !== undefined && !icons.has(theme[field]!))
				throw new Error(`${field} references unknown icon '${theme[field]}'`);
		}
	}
	return {
		id,
		name: String(theme.name || id),
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
			file: theme.file || "file",
			folder: theme.folder || "folder",
			folderExpanded: theme.folderExpanded || theme.folder || "folder",
			rootFolder: theme.rootFolder || theme.folder || "folder",
			rootFolderExpanded:
				theme.rootFolderExpanded ||
				theme.rootFolder ||
				theme.folderExpanded ||
				theme.folder ||
				"folder",
		},
	};
}

function matchExtension(
	name: string,
	extensions: Map<string, string>,
): string | undefined {
	const lower = name.toLowerCase();
	let dot = lower.indexOf(".");
	// A standalone dotfile has no extension; compound dotfiles still do.
	if (dot === 0 && lower.indexOf(".", 1) === -1) return undefined;
	for (; dot !== -1; dot = lower.indexOf(".", dot + 1)) {
		const ext = lower.slice(dot + 1);
		if (!ext) continue;
		const iconId = extensions.get(ext);
		if (iconId !== undefined) return iconId;
	}
	return undefined;
}

function lastExtension(name: string): string {
	const lower = name.toLowerCase();
	const dot = lower.lastIndexOf(".");
	return dot > 0 ? lower.slice(dot + 1) : "";
}

class FileIconRegistry {
	#pluginScopes = new Map<
		string,
		{ active: boolean; subscriptions: Set<() => void> }
	>();
	#scriptApis = new WeakMap<
		HTMLScriptElement,
		ReturnType<FileIconRegistry["bindPlugin"]>
	>();

	/** Called by the loader before executing a plugin script. */
	bindPlugin(script: HTMLScriptElement, pluginId: string) {
		const previous = this.#pluginScopes.get(pluginId);
		if (previous) throw new Error(`Plugin '${pluginId}' is already bound`);
		const scope = { active: true, subscriptions: new Set<() => void>() };
		this.#pluginScopes.set(pluginId, scope);
		const assertActive = () => {
			if (!scope.active)
				throw new Error(`Icon API for plugin '${pluginId}' has been unloaded`);
		};
		const api = Object.freeze({
			register: (
				pack: Omit<FileIconTheme, "pluginId"> & { pluginId?: string },
			) => {
				assertActive();
				if (pack.pluginId !== undefined && pack.pluginId !== pluginId) {
					throw new Error(
						`Icon pack pluginId must match loading plugin '${pluginId}'`,
					);
				}
				return this.register({ ...pack, pluginId });
			},
			icon: this.icon.bind(this),
			onChange: (listener: Parameters<FileIconRegistry["onChange"]>[0]) => {
				assertActive();
				if (typeof listener !== "function") return () => {};
				// Each subscription gets its own callback, even when plugins share a function.
				const off = this.onChange((info) => listener(info));
				const unsubscribe = () => {
					off();
					scope.subscriptions.delete(unsubscribe);
				};
				scope.subscriptions.add(unsubscribe);
				return unsubscribe;
			},
		});
		this.#scriptApis.set(script, api);
		return api;
	}

	getPluginApi(script: HTMLScriptElement | null) {
		const api = script && this.#scriptApis.get(script);
		if (!api)
			throw new Error(
				'Require "fileIcons" in the plugin main script, or use options.fileIcons in the init callback',
			);
		return api;
	}

	#compiled = new Map<string, CompiledTheme>();
	#listeners = new Set<
		(info: { activeId: string; preferredId: string }) => void
	>();
	#activeId = BUILTIN_THEME_ID;
	#preferredId = BUILTIN_THEME_ID;
	#assetStates = new Map<string, "loading" | "ready" | "failed">();
	#assetRefreshQueued = false;
	#settings: IconThemeSettings | null = null;

	constructor() {
		const builtin = compileTheme(createBuiltinTheme());
		this.#compiled.set(builtin.id, builtin);
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

	/** Register a complete theme, replacing only a theme with the same owner. */
	register(theme: FileIconTheme): { dispose: () => void } {
		const compiled = compileTheme(theme);
		if (compiled.id === BUILTIN_THEME_ID)
			throw new Error("Cannot replace the built-in icon theme");
		const previous = this.#compiled.get(compiled.id);
		if (previous && previous.pluginId !== compiled.pluginId)
			throw new Error(`Icon theme '${compiled.id}' belongs to another plugin`);
		this.#compiled.set(compiled.id, compiled);
		if (compiled.id === this.#preferredId) {
			this.#activate(compiled.id);
			this.#emitChange();
		}
		return {
			dispose: () => {
				if (this.#compiled.get(compiled.id) === compiled)
					this.unregister(compiled.id);
			},
		};
	}

	unregister(id: string): boolean {
		if (id === BUILTIN_THEME_ID) return false;
		if (!this.#compiled.has(id)) return false;
		this.#compiled.delete(id);
		this.#removeThemeStyles(id);
		if (this.#activeId === id) {
			this.#activate(BUILTIN_THEME_ID);
			this.#emitChange();
		}
		return true;
	}

	unregisterByPlugin(pluginId: string): void {
		if (!pluginId) return;
		const scope = this.#pluginScopes.get(pluginId);
		if (scope) {
			scope.active = false;
			// Removing the active pack emits a change; detach plugin code first.
			for (const unsubscribe of scope.subscriptions) unsubscribe();
		}
		this.#pluginScopes.delete(pluginId);
		for (const [id, compiled] of [...this.#compiled]) {
			if (compiled.pluginId === pluginId) this.unregister(id);
		}
	}

	list(): IconThemeInfo[] {
		const list: IconThemeInfo[] = [];
		for (const compiled of this.#compiled.values()) {
			list.push({
				id: compiled.id,
				name: compiled.name,
				available: true,
				pluginId: compiled.pluginId,
			});
		}
		if (this.#preferredId && !this.#compiled.has(this.#preferredId)) {
			list.push({
				id: this.#preferredId,
				name: this.#preferredId,
				available: false,
				pluginId: null,
			});
		}
		return list;
	}

	active(): ActiveIconTheme {
		const compiled = this.#compiled.get(this.#activeId);
		return {
			id: this.#activeId,
			preferredId: this.#preferredId,
			name: compiled?.name || this.#activeId,
			available: this.#compiled.has(this.#preferredId),
		};
	}

	use(id: string, options: { persist?: boolean } = {}): ActiveIconTheme {
		const next =
			typeof id === "string" && id.trim() ? id.trim() : BUILTIN_THEME_ID;
		const persist = options.persist !== false;
		const preferredChanged = next !== this.#preferredId;
		this.#preferredId = next;
		const resolved = this.#compiled.has(next) ? next : BUILTIN_THEME_ID;
		const activeChanged = resolved !== this.#activeId;
		if (activeChanged) this.#activate(resolved);
		if (persist) this.#persistPreferred(next);
		if (preferredChanged || activeChanged) this.#emitChange();
		return this.active();
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
		const languageId = input.languageId;
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

	onChange(
		listener: (info: { activeId: string; preferredId: string }) => void,
	): () => void {
		if (typeof listener !== "function") return () => {};
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	refreshRenderedIcons(root: ParentNode | null = getDocument()): void {
		if (!root) return;

		const apply = () => {
			for (const icon of root.querySelectorAll<HTMLElement>(
				"[data-file-icon-name]",
			)) {
				icon.className =
					`${this.icon({ name: icon.dataset.fileIconName || "", kind: icon.dataset.fileIconKind === "folder" ? "folder" : "file" })} ${icon.dataset.fileIconExtra || ""}`.trim();
			}
			for (const $tile of root.querySelectorAll<HTMLElement>(
				'[data-type="file"][data-name]',
			)) {
				applyLeadClass(
					$tile,
					this.icon({ kind: "file", name: $tile.dataset.name || "" }),
				);
			}

			for (const $tile of root.querySelectorAll<HTMLElement>(
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

			if (root === getDocument()) this.#refreshEditorTabs();
		};

		apply();
	}

	resetForTests(): void {
		for (const id of this.#pluginScopes.keys()) this.unregisterByPlugin(id);
		this.#scriptApis = new WeakMap();
		for (const id of [...this.#compiled.keys()]) {
			if (id !== BUILTIN_THEME_ID) this.unregister(id);
		}
		this.#listeners.clear();
		this.#preferredId = BUILTIN_THEME_ID;
		this.#activeId = BUILTIN_THEME_ID;
		this.#settings = null;
	}

	#activate(id: string): void {
		this.#removeThemeStyles(this.#activeId);
		this.#assetStates = new Map();
		this.#activeId = id;
		this.#applyThemeStyles(this.#compiled.get(id)!);
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

		languageId ||= inferLanguageId(name);
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

		if (
			compiled.id !== BUILTIN_THEME_ID &&
			input.kind === "folder" &&
			input.expanded
		) {
			return this.#resolveFolder(
				{ ...input, expanded: false },
				compiled,
				builtin,
			);
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
		if (def?.className) return def.className;
		if (def?.src && this.#assetReady(compiled, def.src)) {
			return `icon ${assetClassName(compiled.id, iconId)}`;
		}

		if (compiled.id === BUILTIN_THEME_ID) {
			if (input.kind === "folder") return buildBuiltinFolderClass();
			if (iconId === "file")
				return buildBuiltinFileClass("default", languageId);
			return buildBuiltinFileClass(iconId, languageId);
		}

		return "";
	}

	#assetReady(compiled: CompiledTheme, src: string): boolean {
		if (typeof Image === "undefined") return true;
		const state = this.#assetStates.get(src);
		if (state) return state === "ready";
		this.#assetStates.set(src, "loading");
		const image = new Image();
		const states = this.#assetStates;
		const finish = (ready: boolean) => {
			image.onload = image.onerror = null;
			if (
				this.#compiled.get(compiled.id) !== compiled ||
				this.#activeId !== compiled.id ||
				this.#assetStates !== states
			)
				return;
			states.set(src, ready ? "ready" : "failed");
			if (!ready)
				console.warn(
					`[fileIcons] Theme '${compiled.id}' could not load '${src}'; using fallback`,
				);
			if (!this.#assetRefreshQueued) {
				this.#assetRefreshQueued = true;
				const refresh = () => {
					this.#assetRefreshQueued = false;
					this.#emitChange();
				};
				if (typeof requestAnimationFrame === "function")
					requestAnimationFrame(refresh);
				else queueMicrotask(refresh);
			}
		};
		image.onload = () => finish(true);
		image.onerror = () => finish(false);
		image.src = src;
		return false;
	}

	#applyThemeStyles(compiled: CompiledTheme): void {
		const doc = getDocument();
		if (!doc) return;

		const rules: string[] = [];
		for (const [iconId, def] of compiled.icons) {
			if (def.src)
				rules.push(
					cssForSrc(
						assetClassName(compiled.id, iconId),
						def.src,
						!!def.monochrome,
					),
				);
		}

		let style = doc.head.querySelector(
			`style[data-file-icon="${compiled.id}"]`,
		);
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

function normalizeResource(
	resource: IconResource | string,
): NormalizedResource {
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
	if (
		!$lead ||
		$lead.classList.contains("text") ||
		$lead.classList.contains("tail")
	) {
		return;
	}
	$lead.className = className;
}

const fileIcons = new FileIconRegistry();

export { BUILTIN_THEME_ID, SCHEMA_VERSION };
export default fileIcons;
