#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ACTION="${1:-}"

if [ -z "$ACTION" ]; then
	echo "Usage: $0 {build|start|dev|check} [arguments...]" >&2
	exit 2
fi
shift

COMMAND=()
NEEDS_ANDROID=true

case "$ACTION" in
	build)
		COMMAND=(bash "$ROOT/utils/scripts/build.sh" "$@")
		;;
	start)
		COMMAND=(bash "$ROOT/utils/scripts/start.sh" "$@")
		case "${1:-android}" in
			android) ;;
			*) NEEDS_ANDROID=false ;;
		esac
		;;
	dev)
		COMMAND=(node "$ROOT/utils/scripts/dev.js" "$@")
		for argument in "$@"; do
			case "$argument" in
				android) break ;;
				ios|browser)
					NEEDS_ANDROID=false
					break
					;;
			esac
		done
		;;
	check)
		;;
	*)
		echo "Unknown Android action: $ACTION" >&2
		exit 2
		;;
esac

if [ "$NEEDS_ANDROID" = false ]; then
	exec "${COMMAND[@]}"
fi

is_java_17() {
	local java_home="$1"
	[ -x "$java_home/bin/java" ] &&
		"$java_home/bin/java" -version 2>&1 | head -n 1 | grep -Eq 'version "17([.]|"|$)'
}

find_java_17() {
	local candidate

	if [ -n "${CORDOVA_JAVA_HOME:-}" ]; then
		if is_java_17 "$CORDOVA_JAVA_HOME"; then
			printf '%s\n' "$CORDOVA_JAVA_HOME"
			return
		fi
		echo "CORDOVA_JAVA_HOME must point to JDK 17: $CORDOVA_JAVA_HOME" >&2
		exit 1
	fi

	if [ -n "${JAVA_HOME:-}" ] && is_java_17 "$JAVA_HOME"; then
		printf '%s\n' "$JAVA_HOME"
		return
	fi

	if [ -x /usr/libexec/java_home ]; then
		candidate="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
		if [ -n "$candidate" ] && is_java_17 "$candidate"; then
			printf '%s\n' "$candidate"
			return
		fi
	fi

	if [ -n "${HOME:-}" ] && [ -d "$HOME/.sdkman/candidates/java" ]; then
		while IFS= read -r candidate; do
			if is_java_17 "$candidate"; then
				printf '%s\n' "$candidate"
				return
			fi
		done < <(find "$HOME/.sdkman/candidates/java" -maxdepth 1 -type d -name '17*' -print | sort -r)
	fi

	if [ -d /Library/Java/JavaVirtualMachines ]; then
		for candidate in /Library/Java/JavaVirtualMachines/*/Contents/Home; do
			if is_java_17 "$candidate"; then
				printf '%s\n' "$candidate"
				return
			fi
		done
	fi

	echo "JDK 17 was not found. Install it or set CORDOVA_JAVA_HOME to its home directory." >&2
	exit 1
}

find_android_home() {
	local candidate

	if [ -n "${ANDROID_HOME:-}" ]; then
		if [ -d "$ANDROID_HOME" ]; then
			printf '%s\n' "$ANDROID_HOME"
			return
		fi
		echo "ANDROID_HOME points to a missing directory: $ANDROID_HOME" >&2
		exit 1
	fi

	if [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -d "$ANDROID_SDK_ROOT" ]; then
		printf '%s\n' "$ANDROID_SDK_ROOT"
		return
	fi

	if [ -n "${HOME:-}" ]; then
		for candidate in \
			"$HOME/Library/Android/sdk" \
			"$HOME/Android/Sdk" \
			"$HOME/Development/android"; do
			if [ -d "$candidate" ]; then
				printf '%s\n' "$candidate"
				return
			fi
		done
	fi

	echo "Android SDK was not found. Set ANDROID_HOME to the SDK directory." >&2
	exit 1
}

checksum() {
	if command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{print $1}'
	elif command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	else
		echo "A SHA-256 utility (shasum or sha256sum) is required." >&2
		return 1
	fi
}

JAVA_17_HOME="$(find_java_17)"
ANDROID_SDK_HOME="$(find_android_home)"

export JAVA_HOME="$JAVA_17_HOME"
export CORDOVA_JAVA_HOME="$JAVA_17_HOME"
export ANDROID_HOME="$ANDROID_SDK_HOME"
unset ANDROID_SDK_ROOT
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:${PATH:-}"

if ! command -v gradle >/dev/null 2>&1; then
	echo "Gradle is required to generate Cordova's wrapper. Install Gradle and retry." >&2
	exit 1
fi

CORDOVA_DEFAULTS="$ROOT/node_modules/cordova-android/lib/gradle-config-defaults.js"
if [ ! -f "$CORDOVA_DEFAULTS" ]; then
	echo "cordova-android is not installed. Run npm install and retry." >&2
	exit 1
fi

GRADLE_VERSION="$(CORDOVA_DEFAULTS="$CORDOVA_DEFAULTS" node -e 'console.log(require(process.env.CORDOVA_DEFAULTS).GRADLE_VERSION)')"
case "$GRADLE_VERSION" in
	8.14.2)
		GRADLE_SHA256="7197a12f450794931532469d4ff21a59ea2c1cd59a3ec3f89c035c3c420a6999"
		;;
	*)
		echo "Unsupported Cordova Gradle version: $GRADLE_VERSION" >&2
		echo "Update utils/scripts/android.sh with the official checksum before building." >&2
		exit 1
		;;
esac

if [ -n "${GRADLE_USER_HOME:-}" ]; then
	GRADLE_CACHE_ROOT="$GRADLE_USER_HOME"
elif [ -n "${HOME:-}" ]; then
	GRADLE_CACHE_ROOT="$HOME/.gradle"
else
	echo "HOME or GRADLE_USER_HOME is required for the Gradle distribution cache." >&2
	exit 1
fi

GRADLE_CACHE_DIR="$GRADLE_CACHE_ROOT/acode/distributions"
GRADLE_ZIP="$GRADLE_CACHE_DIR/gradle-$GRADLE_VERSION-bin.zip"
GRADLE_URL="https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
mkdir -p "$GRADLE_CACHE_DIR"

if [ -f "$GRADLE_ZIP" ] && [ "$(checksum "$GRADLE_ZIP")" != "$GRADLE_SHA256" ]; then
	echo "[android] Cached Gradle archive is invalid; downloading a fresh copy."
	rm -f "$GRADLE_ZIP"
fi

if [ ! -f "$GRADLE_ZIP" ]; then
	if ! command -v curl >/dev/null 2>&1; then
		echo "curl is required for the first Gradle download." >&2
		exit 1
	fi

	PARTIAL_ZIP="$GRADLE_ZIP.part.$$"
	trap 'rm -f "$PARTIAL_ZIP"' EXIT INT TERM
	echo "[android] Downloading Gradle $GRADLE_VERSION once for reliable local builds..."
	curl \
		--fail \
		--location \
		--retry 3 \
		--retry-delay 2 \
		--retry-all-errors \
		--connect-timeout 30 \
		--max-time 600 \
		--progress-bar \
		--output "$PARTIAL_ZIP" \
		"$GRADLE_URL"

	if [ "$(checksum "$PARTIAL_ZIP")" != "$GRADLE_SHA256" ]; then
		echo "Gradle $GRADLE_VERSION checksum verification failed." >&2
		exit 1
	fi

	mv "$PARTIAL_ZIP" "$GRADLE_ZIP"
	trap - EXIT INT TERM
else
	echo "[android] Using verified Gradle $GRADLE_VERSION cache."
fi

export CORDOVA_ANDROID_GRADLE_DISTRIBUTION_URL
CORDOVA_ANDROID_GRADLE_DISTRIBUTION_URL="$(node -e 'console.log(require("node:url").pathToFileURL(process.argv[1]).href)' "$GRADLE_ZIP")"

echo "[android] JAVA_HOME=$JAVA_HOME"
echo "[android] ANDROID_HOME=$ANDROID_HOME"

if [ "$ACTION" = check ]; then
	TOOLS_DIR="$ROOT/platforms/android/tools"
	if [ ! -d "$TOOLS_DIR" ]; then
		echo "Cordova Android platform is missing. Run npm run clean before checking the wrapper." >&2
		exit 1
	fi
	gradle -p "$TOOLS_DIR" wrapper --gradle-distribution-url "$CORDOVA_ANDROID_GRADLE_DISTRIBUTION_URL"
	exit $?
fi

exec "${COMMAND[@]}"
