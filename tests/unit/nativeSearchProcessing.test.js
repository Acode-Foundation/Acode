import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const hasJava = spawnSync("javac", ["-version"]).status === 0;
it.skipIf(!hasJava)(
	"native preview scans stay bounded and regex input observes cancellation/deadlines",
	() => {
		const source = readFileSync(
			new URL(
				"../../src/plugins/sdcard/src/android/WorkspaceIndex.java",
				import.meta.url,
			),
			"utf8",
		);
		const helpers = source.slice(
			source.indexOf("  private static final class SearchInput"),
			source.indexOf("  private void sendStatus("),
		);
		const matching = source.slice(
			source.indexOf("  private void searchInContent("),
			source.indexOf("  private String getFileContent("),
		);
		const positions = source.slice(
			source.indexOf("  private JSONObject position("),
			source.indexOf("  // Java's Matcher"),
		);
		const directory = mkdtempSync(join(tmpdir(), "acode-native-search-"));
		try {
			writeFileSync(
				join(directory, "SearchCheck.java"),
				`
import java.util.regex.Pattern;
import java.util.regex.Matcher;
class SearchCheck {
 static final int MAX_MATCHES_PER_FILE = 5000;
 static final int SEARCH_RESULT_BATCH_MATCHES = 200;
 static class Job { volatile boolean cancelled; String id = "test"; }
 static class JSONException extends Exception {}
 static class JSONObject extends java.util.HashMap<String, Object> {
  public JSONObject put(String key, Object value) { super.put(key, value); return this; }
 }
 static class JSONArray extends java.util.ArrayList<Object> {
  int length() { return size(); }
  JSONArray put(Object value) { add(value); return this; }
 }
 static class CallbackContext { java.util.List<JSONObject> events = new java.util.ArrayList<>(); }
 JSONObject baseEvent(String id, String type) { return new JSONObject().put("type", type); }
 void send(CallbackContext callback, JSONObject event, boolean keep) { callback.events.add(event); }
 ${matching}
 ${positions}
 ${helpers}
 public static void main(String[] args) throws Exception {
  SearchCheck test = new SearchCheck();
  CallbackContext callback = new CallbackContext();
  test.searchInContent(new JSONObject(), "x ".repeat(6000), Pattern.compile("x"), new Job(), callback, false);
  int count = 0;
  for (JSONObject event : callback.events) {
   JSONObject data = (JSONObject) event.get("data");
   int batchSize = ((JSONArray) data.get("matches")).length();
   if (batchSize > 200) throw new AssertionError("batch size");
   count += batchSize;
  }
  if (count != 5000 || !Boolean.TRUE.equals(((JSONObject) callback.events.get(callback.events.size() - 1).get("data")).get("limited"))) throw new AssertionError("original file limit");
  String line = "x ".repeat(100000);
  for (int i = 0; i < 100000; i++) {
   if (test.getSurrounding(line, "x", i * 2, i * 2 + 1)[0].length() > 166) throw new AssertionError("preview size");
  }
  Job job = new Job(); job.cancelled = true;
  try { Pattern.compile("x").matcher(new SearchInput(line, job)).find(); throw new AssertionError("not cancelled"); }
  catch (IllegalStateException expected) {}
  long start = System.nanoTime();
  try { Pattern.compile("(a+)+$").matcher(new SearchInput("a".repeat(100000) + "!", new Job())).find(); throw new AssertionError("no timeout"); }
  catch (IllegalStateException expected) {
   if (!expected.getMessage().contains("timed out")) throw expected;
  }
  if (System.nanoTime() - start > 4_000_000_000L) throw new AssertionError("deadline exceeded");
 }
}`,
			);
			const compile = spawnSync(
				"javac",
				[join(directory, "SearchCheck.java")],
				{ encoding: "utf8" },
			);
			expect(compile.status, compile.stderr).toBe(0);
			const run = spawnSync("java", ["-cp", directory, "SearchCheck"], {
				encoding: "utf8",
				timeout: 6000,
			});
			expect(run.status, run.stderr).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	10000,
);
