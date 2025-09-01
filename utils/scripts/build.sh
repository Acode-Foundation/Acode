#!/bin/bash
# Default values
app="paid"
mode="d"
fdroidFlag=""
buildType="apk"  # New default: apk or aar
webpackmode="development"
cordovamode=""

# Check all arguments for specific values
for arg in "$@"; do
    case "$arg" in
        "free"|"paid")
            app="$arg"
            ;;
        "p"|"prod"|"d"|"dev")
            mode="$arg"
            ;;
        "fdroid")
            fdroidFlag="fdroid"
            ;;
        "apk"|"aar")
            buildType="$arg"
            ;;
        *)
            echo "Warning: Unknown argument '$arg' ignored"
            ;;
    esac
done

root=$(npm prefix)

if [ -n "$TMPDIR" ] && [ -r "$TMPDIR" ] && [ -w "$TMPDIR" ]; then
  tmpdir="$TMPDIR"
elif [ -r "/tmp" ] && [ -w "/tmp" ]; then
  tmpdir="/tmp"
else
  echo "Error: No usable temporary directory found (TMPDIR or /tmp not accessible)." >&2
  exit 1
fi

if [[ "$fdroidFlag" == "fdroid" ]]; then
  echo "true" > "$tmpdir/fdroid.bool"
  cordova plugin remove com.foxdebug.acode.rk.exec.proot
else
  echo "false" > "$tmpdir/fdroid.bool"
  cordova plugin add src/plugins/proot/
fi

# Normalize mode values
if [ "$mode" = "p" ] || [ "$mode" = "prod" ]
then
mode="p"
webpackmode="production"
cordovamode="--release"
fi

# Set build target based on buildType
if [ "$buildType" = "aar" ]; then
    echo "Building AAR library file..."
else
    echo "Building APK file..."
fi

RED=''
NC=''

script1="node ./utils/config.js $mode $app"
script2="webpack --progress --mode $webpackmode "
# script3="node ./utils/loadStyles.js"
script4="cordova build android $cordovamode --packageType=$buildType"

eval "
echo \"${RED}$script1${NC}\";
$script1;
echo \"${RED}$script2${NC}\";
$script2&&
# echo \"${RED}$script3${NC}\";
# $script3;
echo \"${RED}$script4${NC}\";
$script4;
"
