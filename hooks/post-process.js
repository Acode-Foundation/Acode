/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const buildFilePath = path.resolve(__dirname, '../build.json');
const copyToPath = path.resolve(__dirname, '../platforms/android/build.json');
const gradleFilePath = path.resolve(__dirname, '../build-extras.gradle');
const androidGradleFilePath = path.resolve(
  __dirname,
  '../platforms/android/app/build-extras.gradle'
);
const resPath = path.resolve(__dirname, '../platforms/android/app/src/main/res/');
const localResPath = path.resolve(__dirname, '../res/android/');

if (
  !fs.existsSync(copyToPath)
  && fs.existsSync(buildFilePath)
) fs.copyFileSync(buildFilePath, copyToPath);

if (fs.existsSync(androidGradleFilePath)) fs.unlinkSync(androidGradleFilePath);
fs.copyFileSync(gradleFilePath, androidGradleFilePath);

// Cordova Android 15 generates `cdv_*` resources and version-qualified value
// directories that are required later in the build. Keep the generated tree and
// only overlay this project's custom resources on top of it.
copyDirRecursively(localResPath, resPath);
enableLegacyJni();
enableStaticContext();
patchTargetSdkVersion();
enableKeyboardWorkaround();


function getTmpDir() {
  const tmpdirEnv = process.env.TMPDIR;

  if (tmpdirEnv) {
    try {
      fs.accessSync(tmpdirEnv, fs.constants.R_OK | fs.constants.W_OK);
      return tmpdirEnv;
    } catch {
      // TMPDIR exists but not accessible
    }
  }

  try {
    fs.accessSync("/tmp", fs.constants.R_OK | fs.constants.W_OK);
    return "/tmp";
  } catch {
    console.log("Error: No usable temporary directory found (TMPDIR or /tmp not accessible).");
    return null;
    // process.exit(1);
  }
}

function patchTargetSdkVersion() {
  const prefix = execSync('npm prefix').toString().trim();
  const gradleFile = path.join(prefix, 'platforms/android/app/build.gradle');

  if (!fs.existsSync(gradleFile)) {
    console.warn('[Cordova Hook] ⚠️ build.gradle not found');
    return;
  }

  let content = fs.readFileSync(gradleFile, 'utf-8');

  const sdkRegex = /targetSdkVersion\s+(cordovaConfig\.SDK_VERSION|\d+)/;

  if (sdkRegex.test(content)) {
    let api = "36";
    const tmp = getTmpDir();
    if (tmp == null) {
      console.warn("---------------------------------------------------------------------------------\n\n\n\n");
      console.warn(`⚠️ fdroid.bool not found`);
      console.warn("⚠️ Fdroid flavour will be built");
      api = "28";
      console.warn("\n\n\n\n---------------------------------------------------------------------------------");
    } else {
      const froidFlag = path.join(getTmpDir(), 'fdroid.bool');

      if (fs.existsSync(froidFlag)) {
        const fdroid = fs.readFileSync(froidFlag, 'utf-8').trim();
        if (fdroid == "true") {
          api = "28";
        }
      } else {
        console.warn("---------------------------------------------------------------------------------\n\n\n\n");
        console.warn(`⚠️ fdroid.bool not found`);
        console.warn("⚠️ Fdroid flavour will be built");
        api = "28";
        console.warn("\n\n\n\n---------------------------------------------------------------------------------");
        //process.exit(1);
      }
    }


    content = content.replace(sdkRegex, 'targetSdkVersion ' + api);
    fs.writeFileSync(gradleFile, content, 'utf-8');
    console.log('[Cordova Hook] ✅ Patched targetSdkVersion to ' + api);
  } else {
    console.warn('[Cordova Hook] ⚠️ targetSdkVersion not found');
  }
}


function enableLegacyJni() {
  const prefix = execSync('npm prefix').toString().trim();
  const gradleFile = path.join(prefix, 'platforms/android/app/build.gradle');

  if (!fs.existsSync(gradleFile)) return;

  let content = fs.readFileSync(gradleFile, 'utf-8');
  // Check for correct block to avoid duplicate insertion
  if (content.includes('useLegacyPackaging = true')) return;

  // Inject under android block with correct Groovy syntax
  content = content.replace(/android\s*{/, match => {
    return (
      match +
      `
    packagingOptions {
        jniLibs {
            useLegacyPackaging = true
        }
    }`
    );
  });

  fs.writeFileSync(gradleFile, content, 'utf-8');
  console.log('[Cordova Hook] ✅ Enabled legacy JNI packaging');
}

function enableStaticContext() {
  try {
    const prefix = execSync('npm prefix').toString().trim();
    const mainActivityPath = path.join(
      prefix,
      'platforms/android/app/src/main/java/com/foxdebug/acode/MainActivity.java'
    );

    if (!fs.existsSync(mainActivityPath)) {
      return;
    }

    let content = fs.readFileSync(mainActivityPath, 'utf-8');

    // Skip if fully patched
    if (
      content.includes('WeakReference<Context>') &&
      content.includes('public static Context getContext()') &&
      content.includes('weakContext = new WeakReference<>(this);')
    ) {
      return;
    }

    // Add missing imports
    if (!content.includes('import java.lang.ref.WeakReference;')) {
      content = content.replace(
        /import org\.apache\.cordova\.\*;/,
        match =>
          match +
          '\nimport android.content.Context;\nimport java.lang.ref.WeakReference;'
      );
    }

    // Inject static field and method into class body
    content = content.replace(
      /public class MainActivity extends CordovaActivity\s*\{/,
      match =>
        match +
        `\n\n    private static WeakReference<Context> weakContext;\n\n` +
        `    public static Context getContext() {\n` +
        `        return weakContext != null ? weakContext.get() : null;\n` +
        `    }\n`
    );

    // Insert weakContext assignment inside onCreate
    content = content.replace(
      /super\.onCreate\(savedInstanceState\);/,
      `super.onCreate(savedInstanceState);\n        weakContext = new WeakReference<>(this);`
    );

    fs.writeFileSync(mainActivityPath, content, 'utf-8');
  } catch (err) {
    console.error('[Cordova Hook] ❌ Failed to patch MainActivity:', err.message);
  }
}

function enableKeyboardWorkaround() {
  try{
    const prefix = execSync('npm prefix').toString().trim();
    const mainActivityPath = path.join(
      prefix,
      'platforms/android/app/src/main/java/com/foxdebug/acode/MainActivity.java'
    );

    if (!fs.existsSync(mainActivityPath)) {
      return;
    }

    let content = fs.readFileSync(mainActivityPath, 'utf-8');

    // Skip if already patched
    if (content.includes('SoftInputAssist')) {
      return;
    }

    // Add import
    if (!content.includes('import com.foxdebug.system.SoftInputAssist;')) {
      content = content.replace(
        /import java.lang.ref.WeakReference;|import org\.apache\.cordova\.\*;/,
        match =>
          match + '\nimport com.foxdebug.system.SoftInputAssist;'
      );
    }

    // Declare field
    if (!content.includes('private SoftInputAssist softInputAssist;')) {
      content = content.replace(
        /public class MainActivity extends CordovaActivity\s*\{/,
        match =>
          match +
          `\n\n    private SoftInputAssist softInputAssist;\n`
      );
    }

    // Initialize in onCreate
    content = content.replace(
      /loadUrl\(launchUrl\);/,
      `loadUrl(launchUrl);\n\n        softInputAssist = new SoftInputAssist(this);`
    );

    fs.writeFileSync(mainActivityPath, content, 'utf-8');
    console.log('[Cordova Hook] ✅ Enabled keyboard workaround');
  } catch (err) {
    console.error('[Cordova Hook] ❌ Failed to enable keyboard workaround:', err.message);
  }
}


/**
 * Copy directory recursively
 * @param {string} src Source directory
 * @param {string} dest Destination directory
 * @param {string[]} skip Files to not copy
 */
function copyDirRecursively(src, dest, skip = [], currPath = '') {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (!exists) {
    console.log(`File ${src} does not exist`);
    return;
  }

  if (!fs.existsSync(dest) && isDirectory) {
    fs.mkdirSync(dest);
  }

  if (exists && isDirectory) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      const relativePath = path.join(currPath, childItemName);
      if (childItemName.startsWith('.')) return;
      if (skip.includes(childItemName) || skip.includes(relativePath)) return;
      copyDirRecursively(
        path.join(src, childItemName),
        path.join(dest, childItemName),
        skip,
        relativePath,
      );
    });
  } else {
    removeConflictingResourceFiles(src, dest);
    fs.copyFileSync(src, dest);

    // log
    const message = `copied: ${path.basename(src)}`;
    console.log('\x1b[32m%s\x1b[0m', message); // green
  }
}

function removeConflictingResourceFiles(src, dest) {
  const parentDir = path.dirname(dest);

  if (!fs.existsSync(parentDir)) {
    return;
  }

  const resourceDirName = path.basename(parentDir);
  if (!resourceDirName.startsWith('mipmap') && !resourceDirName.startsWith('drawable')) {
    return;
  }

  const srcExt = path.extname(src);
  const resourceName = path.basename(src, srcExt);

  for (const existingName of fs.readdirSync(parentDir)) {
    const existingPath = path.join(parentDir, existingName);
    if (existingPath === dest || !fs.statSync(existingPath).isFile()) {
      continue;
    }

    const existingExt = path.extname(existingName);
    const existingResourceName = path.basename(existingName, existingExt);

    if (existingResourceName !== resourceName || existingExt === srcExt) {
      continue;
    }

    fs.rmSync(existingPath);
    console.log('\x1b[31m%s\x1b[0m', `deleted conflicting resource: ${existingName}`);
  }
}
