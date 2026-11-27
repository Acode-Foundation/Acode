type Listener = (...values: any[]) => void;

export class Channel {
	readonly handlers = new Set<Listener>();
	state: 0 | 1 | 2;
	onHasSubscribersChange?: () => void;
	private firedArgs: unknown[] = [];

	constructor(
		readonly type: string,
		sticky = false,
	) {
		this.state = sticky ? 1 : 0;
	}
	get numHandlers() {
		return this.handlers.size;
	}
	subscribe(listener: Listener) {
		if (this.state === 2) {
			listener(...this.firedArgs);
			return;
		}
		const previous = this.handlers.size;
		this.handlers.add(listener);
		if (!previous && this.handlers.size) this.onHasSubscribersChange?.();
	}
	unsubscribe(listener: Listener) {
		if (this.handlers.delete(listener) && !this.handlers.size)
			this.onHasSubscribersChange?.();
	}
	fire(...values: unknown[]) {
		if (this.state === 2) return;
		if (this.state === 1) {
			this.state = 2;
			this.firedArgs = values;
		}
		for (const listener of [...this.handlers]) listener(...values);
		if (this.state === 2) this.handlers.clear();
	}
}

const channels = new Map<string, Channel>();
const deviceReadyChannelsArray: Channel[] = [];
const channel = {
	onNativeReady: createSticky("onNativeReady"),
	onBridgeReady: createSticky("onBridgeReady"),
	onServicesReady: createSticky("onServicesReady"),
	onDeviceReady: createSticky("onDeviceReady"),
	onDOMContentLoaded: createSticky("onDOMContentLoaded"),
	onResume: create("onResume"),
	onPause: create("onPause"),
	deviceReadyChannelsArray,
	create,
	createSticky,
	join,
	waitForInitialization,
	initializationComplete,
};
waitForInitialization("onDOMContentLoaded");
waitForInitialization("onBridgeReady");
export default channel;

function create(name: string) {
	const event = new Channel(name);
	channels.set(name, event);
	return event;
}
function createSticky(name: string) {
	const event = new Channel(name, true);
	channels.set(name, event);
	return event;
}
function waitForInitialization(name: string) {
	const event = channels.get(name) ?? createSticky(name);
	if (!deviceReadyChannelsArray.includes(event))
		deviceReadyChannelsArray.push(event);
}
function initializationComplete(name: string) {
	channels.get(name)?.fire();
}
function join(listener: () => void, events: Channel[]) {
	let remaining = events.length;
	if (!remaining) return listener();
	for (const event of events) {
		if (!event.state) throw new Error("Readiness requires sticky channels");
		event.subscribe(() => {
			if (!--remaining) listener();
		});
	}
}
