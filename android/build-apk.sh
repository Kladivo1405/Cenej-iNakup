#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_SDK_ROOT:?Nastavi ANDROID_SDK_ROOT}"
: "${APK_KEYSTORE:?Nastavi APK_KEYSTORE na datoteko za podpis}"
: "${APK_KEY_ALIAS:?Nastavi APK_KEY_ALIAS}"
: "${APK_STORE_PASSWORD:?Nastavi APK_STORE_PASSWORD}"

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
output=${1:?Podaj izhodno pot do APK-ja}
tools="${ANDROID_BUILD_TOOLS:-$ANDROID_SDK_ROOT/build-tools/35.0.0}"
platform="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"
build=$(mktemp -d)
trap 'rm -rf -- "$build"' EXIT
mkdir -p "$build/classes" "$build/dex"
"$tools/aapt2" compile --dir "$source_dir/res" -o "$build/resources.zip"
"$tools/aapt2" link -I "$platform" --manifest "$source_dir/AndroidManifest.xml" \
    "$build/resources.zip" -o "$build/unsigned.apk"

source="$source_dir/src/si/cenejsinakup/app/MainActivity.java"
if [[ -n ${ANDROID_ECJ_JAR:-} ]]; then
    java -jar "$ANDROID_ECJ_JAR" -source 1.8 -target 1.8 -bootclasspath "$platform" -d "$build/classes" "$source"
else
    javac -source 8 -target 8 -bootclasspath "$platform" -d "$build/classes" "$source"
fi
"$tools/d8" --min-api 23 --lib "$platform" --output "$build/dex" \
    "$build/classes/si/cenejsinakup/app/"*.class
(cd "$build/dex" && zip -q "$build/unsigned.apk" classes.dex)
"$tools/zipalign" -p -f 4 "$build/unsigned.apk" "$build/aligned.apk"
"$tools/apksigner" sign --ks "$APK_KEYSTORE" --ks-key-alias "$APK_KEY_ALIAS" \
    --ks-pass env:APK_STORE_PASSWORD --out "$output" "$build/aligned.apk"
"$tools/apksigner" verify "$output"
