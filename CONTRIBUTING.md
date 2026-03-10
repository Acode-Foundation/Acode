# Contributing to Acode

Thank you for your interest in contributing to Acode! This guide will help you get started with development.

## Quick Start Options

### Option 1: DevContainer (Recommended)

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) in VS Code or other editors that support DevContainers.

2. Clone and open the repository:
   ```bash
   git clone https://github.com/Acode-Foundation/Acode.git
   code Acode
   ```

3. When VS Code prompts "Reopen in Container", click it
   - Or use Command Palette (Cmd/Ctrl+Shift+P) → "Dev Containers: Reopen in Container"

4. Wait for the container to build (~5-10 minutes first time, subsequent opens are instant)

5. Once ready, build the APK:
   ```bash
   pnpm run build paid dev apk
   ```

   > Use any package manager (pnpm, bun, npm, yarn, etc.)

### Option 2: Docker CLI (For Any Editor)

If your editor doesn't support DevContainers, you can use Docker directly:

```bash
# Clone the repository
git clone https://github.com/Acode-Foundation/Acode.git
cd Acode

# Build the Docker image from our Dockerfile
docker build -t acode-dev .devcontainer/

# Run the container with your code mounted
docker run -it --rm \
  -v "$(pwd):/workspaces/acode" \
  -w /workspaces/acode \
  acode-dev \
  bash

# Inside the container, run setup and build
# bun run setup && bun run build paid dev apk
pnpm run setup
pnpm run build paid dev apk # or pnpm run build p d
```

**Keep container running for repeated use:**
```bash
# Start container in background
docker run -d --name acode-dev \
  -v "$(pwd):/workspaces/acode" \
  -w /workspaces/acode \
  acode-dev \
  sleep infinity

# Execute commands in the running container
docker exec -it acode-dev bash -c "pnpm run setup"
docker exec -it acode-dev pnpm run build paid dev apk

# Stop and remove when done
docker stop acode-dev && docker rm acode-dev
```

---

## 🛠️ Manual Setup (Without Docker)

If you prefer not to use Docker at all:

### Prerequisites

| Requirement | Version |
|------------|---------|
| **Node.js** | 18+ (22 recommended) |
| **pnpm** or **bun** | Latest |
| **Java JDK** | 17+ (21 recommended) |
| **Android SDK** | API 35 | 
| **Gradle** | 8.x |

### Environment Setup

Add these to your shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`):

**macOS:**
```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

**Linux:**
```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

Some more environment variables, check [cordova docs](https://cordova.apache.org/docs/en/latest/guide/platforms/android/index.html).

### Build Steps

```bash
# Clone the repository
git clone https://github.com/Acode-Foundation/Acode.git
cd Acode

# Install dependencies and set up Cordova
pnpm run setup

# Build the APK
pnpm run build paid dev apk # or pnpm run build p d
```

The APK will be at: `platforms/android/app/build/outputs/apk/debug/app-debug.apk`


## 📝 Contribution Guidelines

### Before Submitting a PR

1. **Fork** the repository and create a branch from `main`
2. **Make changes** - keep commits focused and atomic
3. **Check code quality:**
   ```bash
   pnpm run check
   ```
4. **Test** on a device or emulator if possible

### Pull Request Checklist

- [ ] Clear description of changes
- [ ] Reference to related issue (if applicable)
- [ ] Screenshots/GIFs for UI changes
- [ ] Passing CI checks

### Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting:
- Run `pnpm run check` before committing
- Install the Biome VS Code extension for auto-formatting

### Commit Messages

Use clear, descriptive messages:
```
feat: add dark mode toggle to settings
fix: resolve crash when opening large files
docs: update build instructions
refactor: simplify file loading logic
```

## 🌍 Adding Translations

1. Create a JSON file in `src/lang/` (e.g., `fr-fr.json` for French)
2. Add it to `src/lib/lang.js`
3. Use the translation utilities:
   ```bash
   pnpm run lang add       # Add new string
   pnpm run lang remove    # Remove string
   pnpm run lang search    # Search strings
   pnpm run lang update    # Update translations
   ```

## ℹ️ Adding New Icons (to the existing font family)
> [!NOTE]
> Acode uses SVG and converts them into a font family, to be used inside the editor and generally for plugin devs.
> 
> **Plugin-specific icons SHOULD NOT be added into the editor. Only generally helpful icons SHOULD BE added**

Many font editing software and web-based tools exist for this purpose. Some of them are listed below.

| Name | Platform |
|------|----------|
| https://icomoon.io/ | Free (Web-Based, PWA-supported, Offline-supported |
| https://fontforge.org/ | Open-Source (Linux, Mac, Windows)

### Steps in Icomoon to add new Icons

1. Download the `icons.ttf` file from https://github.com/Acode-Foundation/Acode/tree/main/src/res/icons
2. Go to https://icomoon.io/ > Start a new Project
3. Import the `icons.ttf` downloaded (in step 1)
4. All icons will be displayed after importing.
4. Import the SVG icon created/downloaded to be added to the Font Family.
5. On the right side, press **enable Show Characters** to view unicode character for that icon.
6. Copy the newly added icon's Unicode character (required for later steps)
7. Repeat Step 4 and Step 6 until all needed new icons are added.
8. Press the export icon from the top left-hand side.
9. Add **Font** in the formats section, expand the **Font**, enter **code-editor-icon** as the font-family for `icons.ttf` file.
10. Press the download button, and a zip file will be downloaded.

### Adding the Unicode characters to style.css.

1. Open `style.css` file present at https://github.com/Acode-Foundation/Acode/tree/main/src/res/icons
2. Add new class called `.icon.icon-name::before` i.e ```.icon.all_inclusive:before { content: "\ea18"; }```
3. `content` (i.e `ea18` -> `\ea18`) property's value is the Unicode Character copied after importing the icon in the font family.
4. Save the file, extract the zip file (downloaded), from the fonts folder, rename `code-editor-icon.ttf` to `icons.ttf`, copy & paste the `icons.ttf` onto https://github.com/Acode-Foundation/Acode/tree/main/src/res/icons
5. commit the changes <ins><b>ON A NEW branch</b></ins> (by following: [Commit Messages guide](#commit-messages))

## 🔌 Plugin Development

To create plugins for Acode:
- [Plugin Starter Repository](https://github.com/Acode-Foundation/acode-plugin)
- [Plugin Documentation](https://docs.acode.app/)
