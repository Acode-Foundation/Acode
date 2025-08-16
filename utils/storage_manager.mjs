#!/usr/bin/env node

import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';


const npmPrefix = execSync('npm prefix').toString().trim();
const pluginXmlPath = join(npmPrefix, 'src/plugins/terminal/plugin.xml');
const permissionLine = `        <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />`;
const permissionRegex = /^\s*<uses-permission android:name="android\.permission\.MANAGE_EXTERNAL_STORAGE"\s*\/>\s*$/gm;

async function addPermission() {
  try {
    let xml = await readFile(pluginXmlPath, 'utf-8');

    if (xml.includes('android.permission.MANAGE_EXTERNAL_STORAGE')) {
      console.log('Permission already exists in plugin.xml');
      return false;
    }

    const pattern = /<config-file\s+target="AndroidManifest\.xml"\s+parent="\/manifest">\s*<\/config-file>/;

    if (pattern.test(xml)) {
      xml = xml.replace(pattern, match => {
        return match.replace(
          '</config-file>',
          `\n${permissionLine}\n    </config-file>`
        );
      });

      await writeFile(pluginXmlPath, xml, 'utf-8');
      console.log('Permission added inside existing <config-file> block.');
      return true
    } else {
      console.error('Could not find <config-file parent="/manifest"> block.');
      return false
    }
  } catch (err) {
    console.error('Failed to add permission:', err);
    return false
  }
}

async function removePermission() {
  try {
    let xml = await readFile(pluginXmlPath, 'utf-8');

    if (!xml.includes('android.permission.MANAGE_EXTERNAL_STORAGE')) {
      console.log('Permission not found — nothing to remove.');
      return false;
    }

    const cleanedXml = xml.replace(permissionRegex, '');
    await writeFile(pluginXmlPath, cleanedXml, 'utf-8');
    console.log('Permission removed from plugin.xml');
    return true
  } catch (err) {
    console.error('Failed to remove permission:', err);
    return false
  }
}


function updatePlugin() {
  try {
    const prefix = execSync('npm prefix').toString().trim();
    const pluginPath = join(prefix, 'src/plugins/terminal');

    execSync('cordova plugin remove com.foxdebug.acode.rk.exec.terminal', { stdio: 'inherit' });
    execSync(`cordova plugin add "${pluginPath}"`, { stdio: 'inherit' });

    console.log('✅ Plugin updated successfully.');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

async function handleAnswer(answer) {
  answer = answer.trim().toLowerCase();
  if (answer === 'yes' || answer === 'y') {
    if(await addPermission()){
      updatePlugin()
    }
   
  } else if (answer === 'no' || answer === 'n') {
    if(await removePermission()){
      updatePlugin()
    }
   
  } else {
    console.error("Invalid input. Please type 'yes' or 'no'.");
    process.exit(1);
  }
}

function prompt() {
  const rl = readline.createInterface({ input, output });
  rl.question("Enable 'MANAGE_EXTERNAL_STORAGE' permission? Y/n: ", async (answer) => {
    rl.close();
    await handleAnswer(answer);
  });
}

const args = process.argv.slice(2);
let answer = null;

if (args.includes('--yes') || args.includes('-y')) {
  answer = 'yes';
} else if (args.includes('--no') || args.includes('-n')) {
  answer = 'no';
} else if (args[0]) {
  answer = args[0];
}

if (answer) {
  await handleAnswer(answer);
} else {
  prompt();
}
