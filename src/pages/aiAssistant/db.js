const DB_NAME = "AIAssistant.db";
const DB_LOCATION = "default"; // 'default' location for cordova-sqlite-storage
let db = null;
// Helper to execute SQL and return a Promise
// This can be used by all other functions.
export function executeSqlAsync(transaction, sql, params = []) {
	return new Promise((resolve, reject) => {
		transaction.executeSql(
			sql,
			params,
			(tx, resultSet) => resolve(resultSet),
			(tx, error) => {
				console.error(
					"[DB EXEC SQL ERR]",
					error.message,
					"Query (first 100 chars):",
					sql.substring(0, 100),
					"Params:",
					params,
				);
				reject(error); // Reject with the SQLite error object
			},
		);
	});
}

// Internal function to initialize tables on a given DB instance
async function initializeTables(dbInstance) {
	return new Promise((resolve, reject) => {
		dbInstance.transaction(
			(tx) => {
				tx.executeSql(`
        CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        createdAt INTEGER,
        lastModifiedAt INTEGER,
        profile TEXT
        )
        `);
				tx.executeSql(`
        CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT,
        role TEXT,
        content TEXT,
        timestamp INTEGER,
        FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
        )
        `);
				tx.executeSql(`
                CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
                    thread_id TEXT NOT NULL,
                    checkpoint_ns TEXT NOT NULL DEFAULT '',
                    checkpoint_id TEXT NOT NULL,
                    parent_checkpoint_id TEXT,
                    checkpoint TEXT,
                    metadata TEXT,
                    updated_at INTEGER,
                    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
                )
            `);
				tx.executeSql(`
                CREATE TABLE IF NOT EXISTS writes (
                    thread_id TEXT NOT NULL,
                    checkpoint_ns TEXT NOT NULL DEFAULT '',
                    checkpoint_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    idx INTEGER NOT NULL,
                    channel TEXT NOT NULL,
                    value TEXT,
                    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel)
                )
            `);

				tx.executeSql(
					`CREATE INDEX IF NOT EXISTS idx_messages_conversationId_timestamp ON messages (conversationId, timestamp ASC)`,
				);
				tx.executeSql(
					`CREATE INDEX IF NOT EXISTS idx_conversations_lastModifiedAt ON conversations (lastModifiedAt DESC)`,
				);
				tx.executeSql(
					`CREATE INDEX IF NOT EXISTS idx_lg_checkpoints_main ON langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id DESC)`,
				);
				tx.executeSql(
					`CREATE INDEX IF NOT EXISTS idx_writes_main ON writes (thread_id, checkpoint_ns, checkpoint_id, task_id, channel)`,
				);
			},
			(transactionError) => {
				console.error(
					"[DB] Transaction error during table initialization:",
					transactionError,
				);
				reject(transactionError);
			},
			() => {
				resolve();
			},
		);
	});
}

// All exported DB functions should call this first.
async function ensureDbOpen() {
	if (db) {
		return db; // Return existing, already open connection
	}

	return new Promise((resolve, reject) => {
		if (!window.sqlitePlugin) {
			const msg =
				"[DB] SQLite plugin is not available. Ensure cordova-sqlite-storage is installed and deviceready has fired.";
			console.error(msg);
			return reject(new Error(msg));
		}

		// Open the database
		const newlyOpenedDb = window.sqlitePlugin.openDatabase(
			{
				name: DB_NAME,
				location: DB_LOCATION,
			},
			async () => {
				// Success opening DB
				try {
					await initializeTables(newlyOpenedDb);
					db = newlyOpenedDb;
					resolve(db);
				} catch (initError) {
					console.error(
						"[DB] Error during table initialization after DB open:",
						initError,
					);
					reject(initError);
				}
			},
			(error) => {
				// Error opening DB
				console.error("[DB] Error opening SQLite DB:", JSON.stringify(error));
				reject(error);
			},
		);
	});
}

export async function openDB() {
	return ensureDbOpen();
}

// --- Conversation Functions ---
export async function addConversation(conversation) {
	const currentDb = await ensureDbOpen();
	return new Promise((resolve, reject) => {
		currentDb.transaction((tx) => {
			executeSqlAsync(
				tx,
				"INSERT INTO conversations (id, title, createdAt, lastModifiedAt, profile) VALUES (?, ?, ?, ?, ?)",
				[
					conversation.id,
					conversation.title,
					conversation.createdAt,
					conversation.lastModifiedAt,
					conversation.profile,
				],
			)
				.then(() => resolve(conversation.id)) // Resolve with the ID on successful insert
				.catch(reject); // Propagate SQL execution error
		}, reject); // Transaction error callback
	});
}

export async function getConversation(id) {
	const currentDb = await ensureDbOpen();
	return new Promise((resolve, reject) => {
		currentDb.readTransaction((tx) => {
			// Use readTransaction for SELECT
			executeSqlAsync(tx, "SELECT * FROM conversations WHERE id = ?", [id])
				.then((resultSet) => {
					if (resultSet.rows.length > 0) {
						resolve(resultSet.rows.item(0));
					} else {
						resolve(null); // Not found
					}
				})
				.catch(reject);
		}, reject);
	});
}

export async function getAllConversations() {
	const currentDb = await ensureDbOpen();
	return new Promise((resolve, reject) => {
		currentDb.readTransaction((tx) => {
			executeSqlAsync(
				tx,
				"SELECT * FROM conversations ORDER BY lastModifiedAt DESC",
				[],
			)
				.then((resultSet) => {
					const conversations = [];
					for (let i = 0; i < resultSet.rows.length; i++) {
						conversations.push(resultSet.rows.item(i));
					}
					resolve(conversations);
				})
				.catch(reject);
		}, reject);
	});
}

export async function updateConversation(conversation) {
	const currentDb = await ensureDbOpen();
	return new Promise((resolve, reject) => {
		currentDb.transaction((tx) => {
			executeSqlAsync(
				tx,
				"UPDATE conversations SET title = ?, lastModifiedAt = ?, profile = ? WHERE id = ?",
				[
					conversation.title,
					conversation.lastModifiedAt,
					conversation.profile,
					conversation.id,
				],
			)
				.then(() => resolve(conversation.id))
				.catch(reject);
		}, reject);
	});
}

export async function deleteConversation(conversationId) {
	const currentDb = await ensureDbOpen();
	return new Promise((resolve, reject) => {
		currentDb.transaction((tx) => {
			// CASCADE DELETE on messages table should handle associated messages
			executeSqlAsync(tx, "DELETE FROM conversations WHERE id = ?", [
				conversationId,
			])
				.then(() => {
					resolve();
				})
				.catch(reject);
		}, reject);
	});
}

// --- Message Functions ---
export async function addMessageToDB(message) {
	const currentDb = await ensureDbOpen();
	return new Promise((resolve, reject) => {
		currentDb.transaction((tx) => {
			executeSqlAsync(
				tx,
				"INSERT INTO messages (id, conversationId, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
				[
					message.id,
					message.conversationId,
					message.role,
					message.content,
					message.timestamp,
				],
			)
				.then(() => resolve(message.id))
				.catch(reject);
		}, reject);
	});
}

export async function getMessagesForConversation(conversationId) {
	const currentDb = await ensureDbOpen();
	return new Promise((resolve, reject) => {
		currentDb.readTransaction((tx) => {
			executeSqlAsync(
				tx,
				"SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp ASC",
				[conversationId],
			)
				.then((resultSet) => {
					const messages = [];
					for (let i = 0; i < resultSet.rows.length; i++) {
						messages.push(resultSet.rows.item(i));
					}
					resolve(messages);
				})
				.catch(reject);
		}, reject);
	});
}
