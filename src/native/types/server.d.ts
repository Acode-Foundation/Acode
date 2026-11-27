interface Server {
	stop(onSuccess: () => void, onError: (error: any) => void): void;
	send(
		id: string,
		data: any,
		onSuccess: () => void,
		onError: (error: any) => void,
	): void;
	port: number;
}

declare const CreateServer: (
	port: number,
	onSuccess: (msg: any) => void,
	onError: (err: any) => void,
) => Server;
