#!/bin/bash
# Default values
app="paid"
mode="d"
fdroidFlag=""
packageType="apk"  # New default: apk or aar
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
        "apk"|"bundle")
            packageType="$arg"
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
  echo "Warning: No usable temporary directory found (TMPDIR or /tmp not accessible). Skipping fdroid.bool file." >&2
  tmpdir=""
fi

if [ "$fdroidFlag" = "fdroid" ]; then
  if [ -n "$tmpdir" ]; then
    echo "true" > "$tmpdir/fdroid.bool"
  fi

  # Remove only if installed
  if [ -d "plugins/com.foxdebug.acode.rk.exec.proot" ]; then
    cordova plugin remove com.foxdebug.acode.rk.exec.proot
  fi
else
  if [ -n "$tmpdir" ]; then
    echo "false" > "$tmpdir/fdroid.bool"
  fi

  # Add only if the src exists and not already installed
  if [ -d "src/plugins/proot" ] && [ ! -d "plugins/com.foxdebug.acode.rk.exec.proot" ]; then
    cordova plugin add src/plugins/proot/
  fi
fi



# Normalize mode values
if [ "$mode" = "p" ] || [ "$mode" = "prod" ]
then
mode="p"
webpackmode="production"
cordovamode="--release"
fi

# Set build target based on packageType
if [ "$packageType" = "bundle" ]; then
    echo "Building AAR library file..."
else
    echo "Building APK file..."
fi

RED=''
NC=''

script1="node ./utils/config.js $mode $app"
script2="webpack --progress --mode $webpackmode "
# script3="node ./utils/loadStyles.js"

echo "type : $packageType"

script4="cordova build android $cordovamode -- --packageType=$packageType"

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
