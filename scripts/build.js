const os = require("os");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const platform = os.platform();
const isWindows = platform === "win32";

// Check for supported platforms
if (
  !["linux", "darwin", "win32"].includes(platform) &&
  !platform.toLowerCase().includes("bsd")
) {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}


// CLI args: appType (free/paid), buildMode (d/p or debug/prod)
const appType = (process.argv[2] || "paid").toLowerCase();
const buildMode = (process.argv[3] || "d").toLowerCase();

// Normalize app type and mode
const normalizedType = appType.startsWith("f") ? "Free" : "Paid";
const normalizedMode =
  buildMode === "p" || buildMode === "prod" || buildMode === "release"
    ? "Release"
    : "Debug";

// Terminal colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32;1m",
  blue: "\x1b[34;1m",
  yellow: "\x1b[33;1m",
  red: "\x1b[31;1m",
  white: "\x1b[37m",
};

// Logging helpers
const log = {
  success: (msg) =>
    console.log(`${colors.green}[+] ${colors.white}${msg}${colors.reset}`),
  info: (msg) =>
    console.log(`${colors.blue}[*] ${colors.white}${msg}${colors.reset}`),
  warn: (msg) =>
    console.log(`${colors.yellow}[~] ${colors.white}${msg}${colors.reset}`),
  error: (msg) => {
    console.error(`${colors.red}[!] ${colors.white}${msg}${colors.reset}`);
    process.exit(1);
  },
};

// Check JAVA_HOME
if (!process.env.JAVA_HOME) {
  log.warn(
    "JAVA_HOME is not set. Please set it to your Java installation path."
  );
} else {
  log.info(`JAVA_HOME: ${process.env.JAVA_HOME}`);
}

// Check ANDROID_HOME
if (!process.env.ANDROID_HOME) {
  log.warn("ANDROID_HOME is not set. Please set it to your Android SDK path.");
} else {
  log.info(`ANDROID_HOME: ${process.env.ANDROID_HOME}`);
}

// Verify Java version is 21
try {
  const versionOutput = execSync("java -version 2>&1").toString();
  const match = versionOutput.match(/version\s+"(\d+)(?:\.(\d+))?/);
  const majorVersion = match ? parseInt(match[1]) : null;

  const versionString = match?.[1]
    ? `${match[1]}${match[2] ? "." + match[2] : ""}`
    : "unknown";
  log.info(`Current Java version is ${versionString}.`);

  if (!majorVersion || majorVersion < 21) {
    log.error(`Java 21 is required.`);
  }
} catch {
  log.error("Java is not installed or not accessible.");
}


// Display config
log.info(`App Type: ${normalizedType}`);
log.info(`Build Mode: ${normalizedMode}`);

// Constants
//for some reason ad id is not properly added to the android manifest by this cordovalugin so instead of editing this
//edit the android/app/src/free/AndroidManifest.xml file
const AD_APP_ID = "ca-app-pub-5911839694379275~4255791238";
const PROJECT_ROOT = execSync("npm prefix").toString().trim();
const androidDir = path.join(PROJECT_ROOT, "android");

try {
  // Plugin logic based on app type
  if (normalizedType === "Paid") {
    log.info("Removing Admob plugins for paid build");
    if (
      execSync("cordova plugin ls")
        .toString()
        .includes("cordova-plugin-consent")
    ) {
      execSync("cordova plugin remove cordova-plugin-consent --save", {
        stdio: "inherit",
      });
    }
    if (
      execSync("cordova plugin ls").toString().includes("admob-plus-cordova")
    ) {
      execSync("cordova plugin remove admob-plus-cordova --save", {
        stdio: "inherit",
      });
    }
  } else {
    log.info("Adding Admob plugins for free build");
    execSync("cordova plugin add cordova-plugin-consent@2.4.0 --save", {
      stdio: "inherit",
    });
    execSync(
      `cordova plugin add admob-plus-cordova@1.28.0 --save --variable APP_ID_ANDROID="${AD_APP_ID}" --variable PLAY_SERVICES_VERSION="21.5.0"`,
      { stdio: "inherit" }
    );
  }

  // Create build folders
  fs.mkdirSync(path.join(PROJECT_ROOT, "www", "css", "build"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(PROJECT_ROOT, "www", "js", "build"), {
    recursive: true,
  });

  // Webpack
  const webpackMode =
    normalizedMode === "Release" ? "production" : "development";
  execSync(`webpack --progress --mode ${webpackMode}`, { stdio: "inherit" });

  // Preload styles
  execSync("node ./utils/loadStyles.js", { stdio: "inherit" });

  // Sync
  execSync("npm run sync", { stdio: "inherit" });

  // Ensure gradlew is executable on Unix systems
  const gradlewPath = path.join(
    androidDir,
    isWindows ? "gradlew.bat" : "gradlew",
  );
  if (!isWindows) {
    fs.chmodSync(gradlewPath, 0o755);
  }

  // Run gradle task
  const gradleTask = `assemble${normalizedType}${normalizedMode}`;
  const gradleCmd = `${isWindows ? "gradlew.bat" : "./gradlew"} ${gradleTask}`;
  execSync(gradleCmd, { cwd: androidDir, stdio: "inherit" });

  log.success("Build completed successfully.");
} catch (e) {
  log.error(`Build failed: ${e.message}`);
}
