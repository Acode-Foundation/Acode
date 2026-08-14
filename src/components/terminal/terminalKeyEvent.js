/**
 * Consume an xterm shortcut on both key phases, but execute its side effect
 * only for keydown. xterm forwards both keydown and keyup to custom handlers.
 */
export function handleTerminalKeyAction(event, action) {
	event.preventDefault();
	if (event.type === "keydown") action();
	return false;
}
