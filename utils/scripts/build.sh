#! /bin/bash

app="$1"
mode="$2"
fdroidFlag="$3"
webpackmode="development"
cordovamode=""

root=$(npm prefix)


if [[ "$fdroidFlag" == "fdroid" ]]; then
  echo "true" > "$root/fdroid.bool"
  cordova plugin remove com.foxdebug.acode.rk.exec.proot
 
else
  echo "false" > "$root/fdroid.bool"
  cordova plugin add src/plugins/proot/
fi

if [ -z "$mode" ]
then
mode="d"
fi

if [ -z "$app" ]
then
app="paid"
fi

if [ "$mode" = "p" ] || [ "$mode" = "prod" ]
then
mode="p"
webpackmode="production"
cordovamode="--release"
fi

RED=''
NC=''
script1="node ./utils/config.js $mode $app"
script2="webpack --progress --mode $webpackmode "
script3="node ./utils/loadStyles.js"
script4="cordova build android $cordovamode"
eval "
echo \"${RED}$script1${NC}\";
$script1;
echo \"${RED}$script2${NC}\";
$script2&&
echo \"${RED}$script3${NC}\";
$script3;
echo \"${RED}$script4${NC}\";
$script4;
"
