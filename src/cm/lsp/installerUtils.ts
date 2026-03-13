const ARCH_ALIASES = {
	aarch64: ["aarch64", "arm64", "arm64-v8a"],
	x86_64: ["x86_64", "amd64"],
	armv7: ["armv7", "armv7l", "armeabi-v7a"],
} as const;

export type NormalizedArch = keyof typeof ARCH_ALIASES;

export function normalizeArchitecture(arch: string | null | undefined): string {
	const normalized = String(arch || "")
		.trim()
		.toLowerCase();

	for (const [canonical, aliases] of Object.entries(ARCH_ALIASES)) {
		if (aliases.includes(normalized as never)) {
			return canonical;
		}
	}

	return normalized;
}

export function getArchitectureMatchers(
	assets: Record<string, string> | undefined | null,
): Array<{ canonicalArch: string; aliases: string[]; asset: string }> {
	if (!assets || typeof assets !== "object") return [];

	const resolved = new Map<string, { aliases: string[]; asset: string }>();
	for (const [rawArch, rawAsset] of Object.entries(assets)) {
		const asset = String(rawAsset || "").trim();
		if (!asset) continue;

		const canonicalArch = normalizeArchitecture(rawArch);
		if (!canonicalArch) continue;

		const aliases = (
			ARCH_ALIASES[canonicalArch as NormalizedArch] || [canonicalArch]
		).map((value) => String(value));
		resolved.set(canonicalArch, { aliases, asset });
	}

	return Array.from(resolved.entries()).map(([canonicalArch, value]) => ({
		canonicalArch,
		aliases: value.aliases,
		asset: value.asset,
	}));
}

export function buildShellArchCase(
	assets: Record<string, string> | undefined | null,
	quote: (value: unknown) => string,
): string {
	return getArchitectureMatchers(assets)
		.map(
			({ aliases, asset }) =>
				`\t${aliases.join("|")}) ASSET=${quote(asset)} ;;`,
		)
		.join("\n");
}
