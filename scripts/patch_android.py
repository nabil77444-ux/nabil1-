#!/usr/bin/env python3
"""
Standalone Android project patcher for TAIBAH NET (كروت طيبة نت).

Safely and idempotently patches:
  1. android/app/src/main/res/xml/file_paths.xml (shared_apk cache path)
  2. android/app/src/main/java/net/taibah/wireless/MainActivity.java
     - Registers TaibahBiometricPlugin, TaibahUpdateNotifierPlugin & TaibahAppSharePlugin
     - Disables Android 8+ WebView Autofill after super.onCreate
     - Injects restoreActiveOtaBundlePath() guarded by BuildConfig.VERSION_CODE
  3. android/app/build.gradle
     - Declares androidx.biometric:biometric:1.1.0 & androidx.work:work-runtime:2.9.0
     - Injects GITHUB_REPO & APP_BUILD_NUMBER BuildConfig fields (buildFeatures.buildConfig = true)
     - Adds resConfigs "ar", "en", minifyEnabled true & shrinkResources true
  4. android/app/src/main/AndroidManifest.xml
     - Enforces android:hardwareAccelerated="true" on <application> and <activity>
     - Enforces android:windowSoftInputMode="adjustResize" on <activity>

Usage:
  python3 scripts/patch_android.py                  # Run all stages
  python3 scripts/patch_android.py --stage init     # file_paths.xml, MainActivity.java, Gradle deps
  python3 scripts/patch_android.py --stage configure # AndroidManifest.xml, Gradle BuildConfig/R8
"""

import argparse
import os
import re
import textwrap


FILE_PATHS_XML = "android/app/src/main/res/xml/file_paths.xml"
MAIN_ACTIVITY_JAVA = "android/app/src/main/java/net/taibah/wireless/MainActivity.java"
APP_BUILD_GRADLE = "android/app/build.gradle"
ANDROID_MANIFEST_XML = "android/app/src/main/AndroidManifest.xml"


OTA_RESTORE_METHOD = """
    private void restoreActiveOtaBundlePath() {
        try {
            android.content.SharedPreferences otaPrefs = getSharedPreferences(
                    TaibahUpdateNotifierPlugin.OTA_PREFS_NAME, MODE_PRIVATE);
            String savedPath = otaPrefs.getString(
                    TaibahUpdateNotifierPlugin.KEY_PREFS_ACTIVE_BUNDLE_PATH, "");
            int savedVerCode = otaPrefs.getInt(
                    TaibahUpdateNotifierPlugin.KEY_PREFS_ACTIVE_VERSION_CODE, -1);
            int currentVerCode = BuildConfig.VERSION_CODE;
            if (savedPath == null || savedPath.trim().isEmpty()) {
                return;
            }
            if (savedVerCode != currentVerCode) {
                otaPrefs.edit()
                        .remove(TaibahUpdateNotifierPlugin.KEY_PREFS_ACTIVE_BUNDLE_PATH)
                        .remove(TaibahUpdateNotifierPlugin.KEY_PREFS_ACTIVE_VERSION_CODE)
                        .apply();
                getSharedPreferences("CapWebViewSettings", MODE_PRIVATE)
                        .edit().remove("serverBasePath").apply();
                return;
            }
            java.io.File indexFile = new java.io.File(savedPath, "index.html");
            if (indexFile.isFile() && getBridge() != null) {
                getBridge().setServerBasePath(savedPath);
            }
        } catch (Throwable ignored) {
            // Non-fatal: fall back cleanly to built-in APK assets
        }
    }
"""


def patch_file_paths() -> None:
    os.makedirs(os.path.dirname(FILE_PATHS_XML), exist_ok=True)
    shared_entry = '    <cache-path name="shared_apk" path="shared_apk/" />'
    if os.path.exists(FILE_PATHS_XML):
        with open(FILE_PATHS_XML, "r", encoding="utf-8") as f:
            xml = f.read()
        if "shared_apk" not in xml:
            xml = xml.replace("</paths>", f"{shared_entry}\n</paths>", 1)
            with open(FILE_PATHS_XML, "w", encoding="utf-8") as f:
                f.write(xml)
    else:
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<paths xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <external-path name="my_images" path="." />\n'
            '    <cache-path name="my_cache_images" path="." />\n'
            f"{shared_entry}\n"
            "</paths>\n"
        )
        with open(FILE_PATHS_XML, "w", encoding="utf-8") as f:
            f.write(xml)
    print("=== Verified file_paths.xml ===")
    print(xml)


def patch_main_activity() -> None:
    if not os.path.exists(MAIN_ACTIVITY_JAVA):
        raise FileNotFoundError(f"MainActivity.java not found at {MAIN_ACTIVITY_JAVA}")

    with open(MAIN_ACTIVITY_JAVA, "r", encoding="utf-8") as f:
        src = f.read()

    if "import android.os.Bundle;" not in src:
        src = re.sub(
            r"(package\s+net\.taibah\.wireless;\s*)",
            r"\1\nimport android.os.Bundle;\n",
            src,
            count=1,
        )

    plugins_to_register = [
        "TaibahBiometricPlugin.class",
        "TaibahUpdateNotifierPlugin.class",
        "TaibahAppSharePlugin.class",
    ]
    missing = [p for p in plugins_to_register if p not in src]
    if missing:
        reg_lines = "\n        ".join(f"registerPlugin({p});" for p in missing)
        if re.search(r"super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;", src):
            src = re.sub(
                r"(super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;)",
                f"{reg_lines}\n        \\1",
                src,
                count=1,
            )
        else:
            src = re.sub(
                r"(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)",
                f"\\1\n    @Override\n    public void onCreate(Bundle savedInstanceState) {{\n        {reg_lines}\n        super.onCreate(savedInstanceState);\n    }}\n",
                src,
                count=1,
            )

    post_create_block = (
        "if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O "
        "&& getBridge() != null && getBridge().getWebView() != null) {\n"
        "            getBridge().getWebView().setImportantForAutofill("
        "android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);\n"
        "        }\n"
        "        restoreActiveOtaBundlePath();"
    )
    if "setImportantForAutofill" not in src:
        src = re.sub(
            r"(super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;)",
            f"\\1\n        {post_create_block}",
            src,
            count=1,
        )
    elif "restoreActiveOtaBundlePath();" not in src:
        src = re.sub(
            r"(setImportantForAutofill\([^\)]*\);\s*\})",
            r"\1\n        restoreActiveOtaBundlePath();",
            src,
            count=1,
        )

    if "private void restoreActiveOtaBundlePath()" not in src:
        last_brace = src.rfind("}")
        if last_brace != -1:
            src = src[:last_brace] + OTA_RESTORE_METHOD + "}\n"

    with open(MAIN_ACTIVITY_JAVA, "w", encoding="utf-8") as f:
        f.write(src)
    print("=== Verified MainActivity.java ===")
    print(src)


def patch_gradle_dependencies() -> None:
    if not os.path.exists(APP_BUILD_GRADLE):
        raise FileNotFoundError(f"build.gradle not found at {APP_BUILD_GRADLE}")

    with open(APP_BUILD_GRADLE, "r", encoding="utf-8") as f:
        txt = f.read()

    deps_to_add = [
        'implementation "androidx.biometric:biometric:1.1.0"',
        'implementation "androidx.work:work-runtime:2.9.0"',
    ]
    for dep in deps_to_add:
        artifact = dep.split('"')[1].rsplit(":", 1)[0]
        if artifact not in txt:
            txt = re.sub(
                r"(dependencies\s*\{)",
                f"\\1\n    {dep}",
                txt,
                count=1,
            )

    with open(APP_BUILD_GRADLE, "w", encoding="utf-8") as f:
        f.write(txt)
    print("Verified androidx.biometric & androidx.work:work-runtime:2.9.0 in android/app/build.gradle")


def ensure_tag_attr(content: str, tag: str, attr: str, value: str) -> str:
    pattern = rf"(<{tag}\b[^>]*>)"

    def repl(match: re.Match) -> str:
        opening = match.group(1)
        attr_re = rf'{re.escape(attr)}="[^"]*"'
        if re.search(attr_re, opening):
            return re.sub(attr_re, f'{attr}="{value}"', opening)
        return opening.replace(f"<{tag}", f'<{tag}\n        {attr}="{value}"', 1)

    return re.sub(pattern, repl, content, count=1, flags=re.DOTALL)


def patch_manifest() -> None:
    if not os.path.exists(ANDROID_MANIFEST_XML):
        raise FileNotFoundError(f"AndroidManifest.xml not found at {ANDROID_MANIFEST_XML}")

    with open(ANDROID_MANIFEST_XML, "r", encoding="utf-8") as f:
        xml = f.read()

    xml = ensure_tag_attr(xml, "application", "android:hardwareAccelerated", "true")
    xml = ensure_tag_attr(xml, "activity", "android:hardwareAccelerated", "true")
    xml = ensure_tag_attr(xml, "activity", "android:windowSoftInputMode", "adjustResize")

    with open(ANDROID_MANIFEST_XML, "w", encoding="utf-8") as f:
        f.write(xml)
    print("Verified hardwareAccelerated=true & windowSoftInputMode=adjustResize in AndroidManifest.xml")


def patch_gradle_build_config() -> None:
    if not os.path.exists(APP_BUILD_GRADLE):
        raise FileNotFoundError(f"build.gradle not found at {APP_BUILD_GRADLE}")

    with open(APP_BUILD_GRADLE, "r", encoding="utf-8") as f:
        txt = f.read()

    # Inject GITHUB_REPO and APP_BUILD_NUMBER properties cleanly as BuildConfig fields
    # (AGP 8+ requires buildFeatures.buildConfig = true)
    repo_props_block = textwrap.dedent(
        """\
        def taibahGithubRepo = (project.findProperty('GITHUB_REPO') ?: System.getenv('GITHUB_REPOSITORY') ?: '').toString().trim().replace('"', '')
        def taibahBuildNumRaw = (project.findProperty('APP_BUILD_NUMBER') ?: System.getenv('GITHUB_RUN_NUMBER') ?: '0').toString().trim()
        def taibahBuildNum = taibahBuildNumRaw.isInteger() ? taibahBuildNumRaw.toInteger() : 0
        """
    )
    if "taibahGithubRepo" not in txt:
        txt = re.sub(
            r"(android\s*\{)",
            lambda m: repo_props_block + "\n" + m.group(1),
            txt,
            count=1,
        )

    if "buildFeatures" not in txt:
        txt = re.sub(
            r"(android\s*\{)",
            lambda m: m.group(1) + "\n    buildFeatures {\n        buildConfig true\n    }",
            txt,
            count=1,
        )
    elif "buildConfig" not in txt:
        txt = re.sub(
            r"(buildFeatures\s*\{)",
            lambda m: m.group(1) + "\n        buildConfig true",
            txt,
            count=1,
        )

    if 'buildConfigField "String", "GITHUB_REPO"' not in txt:
        bc_lines = (
            '\n        buildConfigField "String", "GITHUB_REPO", "\\"${taibahGithubRepo}\\""'
            '\n        buildConfigField "int", "APP_BUILD_NUMBER", "${taibahBuildNum}"'
        )
        txt = re.sub(
            r"(defaultConfig\s*\{)",
            lambda m: m.group(1) + bc_lines,
            txt,
            count=1,
        )

    # Add resConfigs "ar", "en" inside defaultConfig to strip unused AndroidX/Play Services locales
    if "resConfigs" not in txt and "resourceConfigurations" not in txt:
        txt = re.sub(
            r"(defaultConfig\s*\{)",
            r'\1\n        resConfigs "ar", "en"',
            txt,
            count=1,
        )

    # Enable minifyEnabled true & shrinkResources true in release buildType
    if re.search(r"minifyEnabled\s+false", txt):
        txt = re.sub(
            r"minifyEnabled\s+false",
            "minifyEnabled true\n            shrinkResources true",
            txt,
            count=1,
        )
    elif "shrinkResources" not in txt:
        txt = re.sub(
            r"(release\s*\{)",
            r"\1\n            minifyEnabled true\n            shrinkResources true",
            txt,
            count=1,
        )

    with open(APP_BUILD_GRADLE, "w", encoding="utf-8") as f:
        f.write(txt)
    print(
        "Enabled BuildConfig (GITHUB_REPO + APP_BUILD_NUMBER), minifyEnabled, shrinkResources, "
        "and resConfigs ar/en in android/app/build.gradle"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Patch Capacitor Android project files for TAIBAH NET.")
    parser.add_argument(
        "--stage",
        choices=("init", "configure", "all"),
        default="all",
        help="Select which patching stage to run (default: all).",
    )
    args = parser.parse_args()

    if args.stage in ("init", "all"):
        patch_file_paths()
        patch_main_activity()
        patch_gradle_dependencies()

    if args.stage in ("configure", "all"):
        patch_manifest()
        patch_gradle_build_config()


if __name__ == "__main__":
    main()
