import {
	BaseCheckpointSaver,
	copyCheckpoint,
	getCheckpointId,
	TASKS,
	WRITES_IDX_MAP,
} from "@langchain/langgraph-checkpoint";
import { executeSqlAsync, openDB } from "./db";

const checkpointMetadataKeys = ["source", "step", "writes", "parents"];
function validateKeys(keys) {
	return keys;
}
const validCheckpointMetadataKeys = validateKeys(checkpointMetadataKeys);

// Helper to convert Uint8Array or other forms to a UTF-8 string for DB storage
function ensureStringForDB(serializedData) {
	if (typeof serializedData === "string") {
		return serializedData;
	}
	if (serializedData instanceof Uint8Array) {
		try {
			return new TextDecoder().decode(serializedData);
		} catch (e) {
			console.error(
				"TextDecoder failed for Uint8Array, falling back to JSON.stringify:",
				e,
				serializedData,
			);
			return JSON.stringify(serializedData); // Last resort, might not be ideal
		}
	}
	if (
		Array.isArray(serializedData) &&
		serializedData.every((n) => typeof n === "number")
	) {
		try {
			return String.fromCharCode(...serializedData);
		} catch (e) {
			console.error(
				"String.fromCharCode failed, falling back to JSON.stringify:",
				e,
			);
			return JSON.stringify(serializedData);
		}
	}
	if (serializedData === null || serializedData === undefined) {
		return null; // Store actual nulls as null
	}
	// Last resort for other unexpected object types
	return JSON.stringify(serializedData);
}

export class CordovaSqliteSaver extends BaseCheckpointSaver {
	constructor(serde) {
		super(serde);
		this.db = null;
		this.isSetup = false;
	}

	static async create(serde) {
		const saver = new CordovaSqliteSaver(serde);
		await saver.setup();
		return saver;
	}

	async setup() {
		if (this.isSetup) return;
		this.db = await openDB();
		this.isSetup = true;
	}

	_extractIds(config, methodName = "") {
		const thread_id = config?.configurable?.thread_id;
		const lookup_checkpoint_id = config?.configurable?.checkpoint_id;

		if (
			!thread_id &&
			(methodName === "put" ||
				methodName === "getTuple" ||
				methodName === "list")
		) {
			console.error(
				`${methodName}: thread_id is required in config. Config received:`,
				JSON.stringify(config),
			);
			throw new Error(`${methodName}: thread_id is required in config.`);
		}
		return { thread_id, lookup_checkpoint_id };
	}

	/**
	 * Retrieves a complete checkpoint tuple (checkpoint, config, metadata, pending writes, parent config)
	 * from the database for a given thread and optional specific checkpoint ID.
	 * @param {object} config - Configuration object, typically containing `thread_id` and optionally `checkpoint_id` and `checkpoint_ns`.
	 * @returns {Promise<object | undefined>} A promise that resolves to the checkpoint tuple
	 *   ({ checkpoint, config, metadata, parentConfig, pendingWrites }) or `undefined` if not found.
	 * @throws {Error} If a database error occurs during retrieval.
	 */
	async getTuple(config) {
		if (!this.isSetup) await this.setup();

		const { thread_id, lookup_checkpoint_id } = this._extractIds(
			config,
			"getTuple",
		);

		const fetchDataPromise = new Promise((resolveData, rejectData) => {
			this.db.readTransaction(
				(tx) => {
					let mainSql = `SELECT checkpoint_id, parent_checkpoint_id, checkpoint, metadata
                               FROM langgraph_checkpoints WHERE thread_id = ? AND checkpoint_ns = ?`;
					const mainParams = [
						thread_id,
						config.configurable?.checkpoint_ns ?? "",
					];

					if (lookup_checkpoint_id) {
						mainSql += " AND checkpoint_id = ?";
						mainParams.push(lookup_checkpoint_id);
					} else {
						mainSql += " ORDER BY checkpoint_id DESC LIMIT 1";
					}

					tx.executeSql(
						mainSql,
						mainParams,
						(tx_s1, mainResultSet) => {
							if (mainResultSet.rows.length === 0) {
								return rejectData({ name: "CheckpointNotFound" });
							}
							const mainRowData = mainResultSet.rows.item(0);
							const actual_checkpoint_id = mainRowData.checkpoint_id;

							const writesSql = `SELECT task_id, channel, value FROM writes
                                       WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`;
							tx.executeSql(
								writesSql,
								[
									thread_id,
									config.configurable?.checkpoint_ns ?? "",
									actual_checkpoint_id,
								],
								(tx_s2, writesResultSet) => {
									const pendingWritesData = [];
									for (let i = 0; i < writesResultSet.rows.length; i++) {
										pendingWritesData.push(writesResultSet.rows.item(i));
									}

									if (mainRowData.parent_checkpoint_id) {
										const sendsSql = `SELECT value FROM writes
                                              WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND channel = ?
                                              ORDER BY idx`;
										tx.executeSql(
											sendsSql,
											[
												thread_id,
												config.configurable?.checkpoint_ns ?? "",
												mainRowData.parent_checkpoint_id,
												TASKS,
											],
											(tx_s3, sendsResultSet) => {
												const pendingSendsData = [];
												for (let i = 0; i < sendsResultSet.rows.length; i++) {
													pendingSendsData.push(sendsResultSet.rows.item(i));
												}
												resolveData({
													mainRowData,
													pendingWritesData,
													pendingSendsData,
												});
											},
											(tx_e3, errorS3) => rejectData(errorS3),
										);
									} else {
										resolveData({
											mainRowData,
											pendingWritesData,
											pendingSendsData: [],
										});
									}
								},
								(tx_e2, errorW) => rejectData(errorW),
							);
						},
						(tx_e1, errorM) => rejectData(errorM),
					);
				},
				(transactionError) => rejectData(transactionError),
			);
		});

		try {
			const { mainRowData, pendingWritesData, pendingSendsData } =
				await fetchDataPromise;

			const deserializedCheckpointData = await this.serde.loadsTyped(
				mainRowData.type ?? "json",
				mainRowData.checkpoint,
			);
			const deserializedMetadata = await this.serde.loadsTyped(
				mainRowData.type ?? "json",
				mainRowData.metadata,
			);

			const pendingWrites = await Promise.all(
				pendingWritesData.map(async (write) => [
					write.task_id,
					write.channel,
					await this.serde.loadsTyped(write.type ?? "json", write.value),
				]),
			);
			const pending_sends = await Promise.all(
				pendingSendsData.map(async (send) =>
					this.serde.loadsTyped(send.type ?? "json", send.value),
				),
			);

			const checkpoint = { ...deserializedCheckpointData, pending_sends };
			const finalConfig = {
				configurable: {
					thread_id: thread_id,
					checkpoint_ns:
						mainRowData.checkpoint_ns ||
						(config.configurable?.checkpoint_ns ?? ""),
					checkpoint_id: mainRowData.checkpoint_id,
				},
			};
			return {
				checkpoint,
				config: finalConfig,
				metadata: deserializedMetadata,
				parentConfig: mainRowData.parent_checkpoint_id
					? {
							configurable: {
								thread_id: thread_id,
								checkpoint_ns:
									mainRowData.checkpoint_ns ||
									(config.configurable?.checkpoint_ns ?? ""),
								checkpoint_id: mainRowData.parent_checkpoint_id,
							},
						}
					: undefined,
				pendingWrites,
			};
		} catch (error) {
			/* ... (your existing catch block for CheckpointNotFound etc.) ... */
			if (error && error.name === "CheckpointNotFound") {
				return undefined;
			}
			console.error(
				`getTuple: Error after fetching data for thread ${thread_id}:`,
				error,
			);
			throw error;
		}
	}

	/**
	 * Stores a checkpoint and its metadata in the database.
	 * @param {object} config - Configuration including thread_id and optional checkpoint_ns/checkpoint_id.
	 * @param {object} checkpoint - The checkpoint object to save.
	 * @param {object} metadata - Metadata associated with the checkpoint.
	 * @returns {Promise<object>} A promise resolving to an object with configurable details.
	 */
	async put(config, checkpoint, metadata) {
		if (!this.isSetup) await this.setup();

		const thread_id = config.configurable?.thread_id;
		const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";
		const parent_checkpoint_id = config.configurable?.checkpoint_id;

		if (!thread_id) {
			throw new Error(`Missing "thread_id" in config for put.`);
		}
		if (!checkpoint.id) {
			throw new Error(`Missing "id" in checkpoint object for put.`);
		}
		const new_checkpoint_id = checkpoint.id;

		const preparedCheckpoint = copyCheckpoint(checkpoint);
		delete preparedCheckpoint.pending_sends;

		const [typeCp, rawSerializedCheckpoint] =
			this.serde.dumpsTyped(preparedCheckpoint);
		const [typeMd, rawSerializedMetadata] = this.serde.dumpsTyped(metadata);

		// Ensure strings for DB
		const finalSerializedCheckpoint = ensureStringForDB(
			rawSerializedCheckpoint,
		);
		const finalSerializedMetadata = ensureStringForDB(rawSerializedMetadata);

		return new Promise((resolve, reject) => {
			this.db.transaction((tx) => {
				executeSqlAsync(
					tx,
					`INSERT OR REPLACE INTO langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata)
                     VALUES ( ?, ?, ?, ?, ?, ?)`,
					[
						thread_id,
						checkpoint_ns,
						new_checkpoint_id,
						parent_checkpoint_id,
						finalSerializedCheckpoint,
						finalSerializedMetadata,
					],
				)
					.then(() => {
						resolve({
							configurable: {
								thread_id,
								checkpoint_ns,
								checkpoint_id: new_checkpoint_id,
							},
						});
					})
					.catch(reject); // SQL errors
			}, reject); // Transaction errors
		});
	}

	/**
	 * Stores writes associated with a specific thread and checkpoint.
	 * @param {object} config - Configuration including thread_id, checkpoint_ns, and checkpoint_id.
	 * @param {Array<[string, any]>} writes - An array of [channel, value] tuples to store.
	 * @param {string} taskId - The ID of the task performing the writes.
	 * @returns {Promise<void>} A promise that resolves when writes are stored.
	 */
	async putWrites(config, writes, taskId) {
		if (!this.isSetup) await this.setup();

		const thread_id = config.configurable?.thread_id;
		const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";
		const checkpoint_id = config.configurable?.checkpoint_id;

		if (!thread_id || !checkpoint_id) {
			throw new Error(
				"Missing thread_id or checkpoint_id in config for putWrites.",
			);
		}
		if (!writes || writes.length === 0) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			this.db.transaction((tx) => {
				const writePromises = writes.map((writeTuple, idx) => {
					const channel = writeTuple[0];
					const value = writeTuple[1];
					const [type, rawSerializedValue] = this.serde.dumpsTyped(value);
					const finalSerializedValue = ensureStringForDB(rawSerializedValue); // Ensure string

					return executeSqlAsync(
						tx,
						`INSERT OR REPLACE INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
						[
							thread_id,
							checkpoint_ns,
							checkpoint_id,
							taskId,
							WRITES_IDX_MAP[channel] || idx,
							channel,
							finalSerializedValue,
						],
					);
				});

				Promise.all(writePromises)
					.then(() => resolve())
					.catch(reject); // Will catch first error from Promise.all
			}, reject); // Transaction errors
		});
	}

	/**
	 * Asynchronously lists checkpoints for a given thread.
	 * @param {object} config - Configuration object.
	 * @param {object} options - Options for listing (limit, before, filter).
	 * @yields {object} A checkpoint tuple.
	 */
	async *list(config, options) {
		if (!this.isSetup) await this.setup();

		const { limit, before, filter } = options ?? {};
		const thread_id = config.configurable?.thread_id;
		const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";

		if (!thread_id) {
			return;
		}

		let checkpointIdRows = []; // To store { checkpoint_id: string }
		try {
			await new Promise((resolveOuter, rejectOuter) => {
				this.db.readTransaction((tx) => {
					let sql = `SELECT checkpoint_id FROM langgraph_checkpoints`;

					const params = [];
					const whereClauses = ["thread_id = ?", "checkpoint_ns = ?"];
					params.push(thread_id, checkpoint_ns);

					if (before?.configurable?.checkpoint_id) {
						whereClauses.push("checkpoint_id < ?");
						params.push(before.configurable.checkpoint_id);
					}
					if (filter && Object.keys(filter).length > 0) {
					}
					if (whereClauses.length > 0) {
						sql += ` WHERE ${whereClauses.join(" AND ")}`;
					}
					sql += ` ORDER BY checkpoint_id DESC`;
					if (limit) {
						// This limit is applied before JS filtering, so fetch more if JS filtering is heavy
						sql += ` LIMIT ${Number.parseInt(limit, 10) * (filter ? 5 : 1)}`; // Fetch more if filtering
					}

					executeSqlAsync(tx, sql, params)
						.then((resultSet) => {
							for (let i = 0; i < resultSet.rows.length; i++) {
								checkpointIdRows.push(resultSet.rows.item(i));
							}
							resolveOuter();
						})
						.catch(rejectOuter);
				}, rejectOuter);
			});

			let yieldedCount = 0;
			for (const idRow of checkpointIdRows) {
				const tupleConfig = {
					configurable: {
						thread_id,
						checkpoint_ns,
						checkpoint_id: idRow.checkpoint_id,
					},
				};
				const fullTuple = await this.getTuple(tupleConfig);
				if (fullTuple) {
					if (
						filter &&
						fullTuple.metadata &&
						!Object.entries(filter).every(
							([key, value]) => fullTuple.metadata[key] === value,
						)
					) {
						continue; // Skip if JS filter doesn't match
					}
					yield fullTuple;
					yieldedCount++;
					if (limit !== undefined && yieldedCount >= limit) break;
				}
			}
		} catch (error) {
			console.error(
				`list: Error fetching/processing for thread ${thread_id}:`,
				error,
			);
		}
	}
}
