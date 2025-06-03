const fs = require('fs');
const path = require('path');

/**
 * Recursively find all `build.gradle` files in the `android/` directory
 */
function findBuildGradleFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);

  list.forEach(file => {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);

    if (stat && stat.isDirectory()) {
      results = results.concat(findBuildGradleFiles(filepath));
    } else if (file === 'build.gradle') {
      results.push(filepath);
    }
  });

  return results;
}

/**
 * Patch build.gradle if needed
 */
function patchBuildGradle(filePath) {
  if(filePath.includes("/app/")){
     return
  }
  let contents = fs.readFileSync(filePath, 'utf8');

  if (!contents.includes('android {')) {
    console.log(`⏭️  Skipping ${filePath} (no android block)`);
    return;
  }

  if (contents.includes('buildConfig true')) {
    console.log(`✅ ${filePath} already contains buildConfig = true`);
    return;
  }

  contents = contents.replace(
    /android\s*\{/,
    `android {\n    buildFeatures {\n        buildConfig true\n    }`
  );

  fs.writeFileSync(filePath, contents);
  console.log(`✅ Patched ${filePath}`);
}

// Run it
const gradleFiles = findBuildGradleFiles(path.resolve('android'));

if (gradleFiles.length === 0) {
  console.log('❌ No build.gradle files found.');
} else {
  gradleFiles.forEach(patchBuildGradle);
}

