const fs = require("fs");
const path = require("path");

const templateResPath = path.resolve(
  __dirname,
  "../node_modules/cordova-android/templates/project/res",
);
const androidResPath = path.resolve(
  __dirname,
  "../platforms/android/app/src/main/res",
);

if (!fs.existsSync(templateResPath) || !fs.existsSync(androidResPath)) {
  process.exit(0);
}

restoreCordovaResourceFiles(templateResPath);

function restoreCordovaResourceFiles(currentPath) {
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    const absolutePath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      restoreCordovaResourceFiles(absolutePath);
      continue;
    }

    if (!shouldRestore(absolutePath)) {
      continue;
    }

    const relativePath = path.relative(templateResPath, absolutePath);
    const destinationPath = path.join(androidResPath, relativePath);

    if (fs.existsSync(destinationPath)) {
      continue;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(absolutePath, destinationPath);
    console.log(`[Cordova Hook] Restored ${relativePath}`);
  }
}

function shouldRestore(filePath) {
  const fileName = path.basename(filePath);

  return fileName.startsWith("cdv_") || fileName === "ic_cdv_splashscreen.xml";
}
