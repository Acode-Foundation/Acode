import type {
	Location,
	LocationLink,
} from "vscode-languageserver-protocol";

export type LspLocationResult =
	| Location
	| Location[]
	| LocationLink[]
	| null;

/** Normalize definition-style responses to the Location shape used by Acode. */
export function normalizeLocations(result: LspLocationResult): Location[] {
	if (!result) return [];
	const locations = Array.isArray(result) ? result : [result];

	return locations.map((location) => {
		if ("targetUri" in location) {
			return {
				uri: location.targetUri,
				range: location.targetSelectionRange ?? location.targetRange,
			};
		}
		return location;
	});
}
