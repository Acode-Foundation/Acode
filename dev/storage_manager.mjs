#!/usr/bin/env node
import readline from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";

const manifest = new URL("../platforms/android/app/src/main/AndroidManifest.xml", import.meta.url);
const args = process.argv.slice(2);
let answer = args[0];
if (!answer) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    answer = await prompt.question("Enable 'MANAGE_EXTERNAL_STORAGE' permission? Y/n: ");
    prompt.close();
}
if (!["y", "yes", "--yes", "-y", "n", "no", "--no", "-n"].includes(answer.toLowerCase())) throw new Error("Choose yes or no.");
const enabled = ["y", "yes", "--yes", "-y"].includes(answer.toLowerCase());
const source = await readFile(manifest, "utf8");
const permission = '    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />';
const clean = source.replace(/\s*<uses-permission android:name="android\.permission\.MANAGE_EXTERNAL_STORAGE"\s*\/>/g, "");
await writeFile(manifest, enabled ? clean.replace("</manifest>", `${permission}\n</manifest>`) : clean);
console.log(`All-files access ${enabled ? "enabled" : "disabled"} for the next Android build.`);
