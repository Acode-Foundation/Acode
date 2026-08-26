/**
 * Promote an open file to durable session persistence when a later open source
 * proves that its URI will remain accessible. Less durable sources, such as
 * external intents, must not revoke an existing durable grant.
 *
 * @param {{persistInSession?: boolean}} file
 * @param {boolean | undefined} requestedPersistence
 */
export function promoteSessionPersistence(file, requestedPersistence) {
	if (requestedPersistence === true) {
		file.persistInSession = true;
	}
}
