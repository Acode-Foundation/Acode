import "core-js/stable";

const DB_NAME = "acode-search-content-cache";
const DB_VERSION = 1;
const INDEX_VERSION = 1;
const MAX_INDEXED_CHARS = 512 * 1024;
const INDEX_IDLE_DELAY = 20;

const pendingFileReads = new Map();
const dirtyUrls = new Set();

let dbPromise;
let syncRunning = false;
let queuedFiles = null;
let fileReadId = 0;

self.onmessage = ({ data }) => {
	const { action, id } = data;

	switch (action) {
		case "sync":
			queueSync(data.data?.files || []);
			break;

		case "query":
			query(data.data)
				.then((result) => {
					self.postMessage({ action: "query-result", id, data: result });
				})
				.catch((error) => {
					self.postMessage({
						action: "query-result",
						id,
						error: error?.message || String(error),
					});
				});
			break;

		case "mark-dirty":
			for (const url of data.data?.urls || []) {
				if (url) dirtyUrls.add(url);
			}
			break;

		case "get-file": {
			const pending = pendingFileReads.get(id);
			if (!pending) return;
			pendingFileReads.delete(id);
			if (data.error) pending.reject(data.error);
			else pending.resolve(data.data || "");
			break;
		}
	}
};

function queueSync(files) {
	queuedFiles = files;
	if (syncRunning) return;

	syncRunning = true;
	runQueuedSync()
		.catch((error) => {
			postStatus({
				state: "error",
				message: error?.message || "Search index unavailable",
			});
		})
		.finally(() => {
			syncRunning = false;
		});
}

async function runQueuedSync() {
	while (queuedFiles) {
		const files = queuedFiles;
		queuedFiles = null;
		await sync(files);
	}
}

async function sync(files) {
	const db = await getDB();
	const existingRecords = await getExistingRecords(db);
	let indexed = 0;
	let skipped = 0;
	const total = files.length;

	postStatus({
		state: total ? "indexing" : "ready",
		indexed,
		total,
		message: total ? "Preparing search cache" : "Search cache ready",
	});

	for (const file of files) {
		const currentRecord = existingRecords.get(file.url);

		if (
			currentRecord &&
			!dirtyUrls.has(file.url) &&
			isRecordCurrent(file, currentRecord)
		) {
			indexed += 1;
			if (currentRecord.skipped) skipped += 1;
			continue;
		}

		try {
			if (file.size && file.size > MAX_INDEXED_CHARS) {
				const record = buildSkippedRecord(file, "large");
				await writeRecord(db, currentRecord, record);
				dirtyUrls.delete(file.url);
				indexed += 1;
				skipped += 1;
				await yieldToEventLoop(INDEX_IDLE_DELAY);
				continue;
			}

			const content = await getFile(file.url);
			const record = buildRecord(file, content);
			await writeRecord(db, currentRecord, record);
			dirtyUrls.delete(file.url);
			indexed += 1;
			if (record.skipped) skipped += 1;
			await yieldToEventLoop(INDEX_IDLE_DELAY);
		} catch {
			skipped += 1;
		}

		if (indexed % 25 === 0 || indexed === total) {
			postStatus({
				state: "indexing",
				indexed,
				total,
				skipped,
				message: `Cached ${indexed}/${total} files`,
			});
			await yieldToEventLoop();
		}
	}

	const currentUrls = new Set(files.map((file) => file.url));
	for (const url of existingRecords.keys()) {
		if (!currentUrls.has(url)) await deleteRecord(db, url);
	}

	postStatus({
		state: "ready",
		indexed,
		total,
		skipped,
		message: "Search cache ready",
	});
}

async function query({
	files = [],
	search = "",
	options = {},
	forceUrls = [],
}) {
	const query = getCacheQuery(search, options);
	const forced = new Set(forceUrls);

	if (!query) {
		return {
			supported: false,
			urls: files.map((file) => file.url),
			stats: {
				reason: "unsupported",
				indexed: 0,
				total: files.length,
			},
		};
	}

	const db = await getDB();
	const requestedUrls = new Set(files.map((file) => file.url));
	const existingRecords = await getExistingRecords(db);
	const fallbackUrls = new Set();
	let indexed = 0;

	for (const file of files) {
		const record = existingRecords.get(file.url);

		if (!record || dirtyUrls.has(file.url)) {
			fallbackUrls.add(file.url);
		} else if (record.skipped) {
			indexed += 1;
			fallbackUrls.add(file.url);
		} else {
			indexed += 1;
		}
	}

	const candidates = getCandidateUrls(existingRecords, requestedUrls, query);
	const urls = new Set(candidates || []);
	for (const url of fallbackUrls) urls.add(url);
	for (const url of forced) {
		if (requestedUrls.has(url)) urls.add(url);
	}

	return {
		supported: true,
		urls: [...urls],
		stats: {
			indexed,
			total: files.length,
			fallback: fallbackUrls.size,
			candidates: candidates?.size || 0,
		},
	};
}

function buildRecord(file, content) {
	if (content.length > MAX_INDEXED_CHARS) {
		return buildSkippedRecord(file, "large");
	}

	return {
		...getFileMetadata(file),
		url: file.url,
		path: file.path,
		name: file.name,
		indexedAt: Date.now(),
		indexVersion: INDEX_VERSION,
		contentHash: hashString(content),
		skipped: false,
		searchText: content.toLocaleLowerCase(),
	};
}

function buildSkippedRecord(file, reason) {
	return {
		...getFileMetadata(file),
		url: file.url,
		path: file.path,
		name: file.name,
		indexedAt: Date.now(),
		indexVersion: INDEX_VERSION,
		skipped: true,
		reason,
		searchText: "",
	};
}

async function writeRecord(db, _oldRecord, record) {
	const tx = db.transaction("files", "readwrite");
	tx.objectStore("files").put(record);
	await transactionDone(tx);
}

async function deleteRecord(db, url) {
	const tx = db.transaction("files", "readwrite");
	tx.objectStore("files").delete(url);
	await transactionDone(tx);
}

function getCandidateUrls(records, requestedUrls, query) {
	const urls = new Set();

	for (const record of records.values()) {
		if (
			!requestedUrls.has(record.url) ||
			record.skipped ||
			dirtyUrls.has(record.url)
		) {
			continue;
		}

		if (recordMatches(record, query)) urls.add(record.url);
	}

	return urls;
}

function recordMatches(record, query) {
	return (record.searchText || "").includes(query.needle);
}

function getCacheQuery(search, { regExp = false, caseSensitive = false } = {}) {
	if (regExp || caseSensitive || !search) return null;
	return { needle: search.toLocaleLowerCase() };
}

async function getExistingRecords(db) {
	const records = await requestToPromise(
		db.transaction("files", "readonly").objectStore("files").getAll(),
	);
	return new Map(records.map((record) => [record.url, record]));
}

function isRecordCurrent(file, record) {
	if (record.indexVersion !== INDEX_VERSION) return false;

	const metadata = getFileMetadata(file);

	if (metadata.size && record.size && metadata.size !== record.size)
		return false;
	if (
		metadata.modifiedDate &&
		record.modifiedDate &&
		metadata.modifiedDate !== record.modifiedDate
	)
		return false;

	return true;
}

function getFileMetadata(file) {
	return {
		size: file.size || 0,
		modifiedDate: normalizeModifiedDate(file.modifiedDate),
	};
}

function normalizeModifiedDate(value) {
	if (!value) return 0;
	if (typeof value === "number") return value;
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? 0 : time;
}

function hashString(value) {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash +=
			(hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return (hash >>> 0).toString(16);
}

function getFile(url) {
	const id = ++fileReadId;
	self.postMessage({ action: "get-file", id, data: url });

	return new Promise((resolve, reject) => {
		pendingFileReads.set(id, { resolve, reject });
	});
}

function postStatus(data) {
	self.postMessage({ action: "status", data });
}

function getDB() {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;

			if (!db.objectStoreNames.contains("files")) {
				db.createObjectStore("files", { keyPath: "url" });
			}

			if (db.objectStoreNames.contains("postings")) {
				db.deleteObjectStore("postings");
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

	return dbPromise;
}

function requestToPromise(request) {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function transactionDone(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

function yieldToEventLoop(delay = 0) {
	return new Promise((resolve) => setTimeout(resolve, delay));
}
