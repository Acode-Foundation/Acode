#!/bin/sh
set -eu
exec node dev/scripts/native.js run "$@"
