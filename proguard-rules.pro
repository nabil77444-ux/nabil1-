# ==============================================================================
# Taibah Net Cards (كروت طيبة نت) — Android Release R8 / ProGuard Rules
# Safely shrinks APK size while preserving Capacitor 7, Native Plugins,
# TaibahBiometricPlugin, AndroidX BiometricPrompt, Contacts, OTA Updater & Firebase.
# ==============================================================================

-optimizationpasses 3
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# Preserve annotations, generics, inner classes, enclosing methods & exceptions
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault

# 1. Capacitor 7 Core, Custom Native Plugins & FragmentActivity Host
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep class * extends androidx.fragment.app.FragmentActivity { *; }
-keep class net.taibah.wireless.** { *; }
-keep class net.taibah.wireless.TaibahAppSharePlugin { *; }
-keep class net.taibah.wireless.TaibahUpdateNotifierPlugin { *; }
-keep class net.taibah.wireless.TaibahBiometricPlugin { *; }
-keep class net.taibah.wireless.UpdateCheckWorker { *; }
-keep class androidx.core.content.FileProvider { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 2. Capgo Plugins (OTA Updater + Native Biometric)
-keep class ee.forgr.** { *; }
-keep class app.capgo.** { *; }

# 3. AndroidX BiometricPrompt & Hardware Keystore
-keep class androidx.biometric.** { *; }
-keep class androidx.security.crypto.** { *; }
-keep class com.epicshaggy.biometric.** { *; }

# 3B. AndroidX WorkManager & Background OTA Update Worker
-keep class * extends androidx.work.ListenableWorker { *; }
-keep class androidx.work.** { *; }

# 4. Official Capacitor Plugins (Contacts, App, Filesystem, Share, StatusBar, Network, Push, Haptics)
-keep class com.getcapacitor.community.contacts.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class io.ionic.libs.ionfilesystemlib.** { *; }

# 5. Firebase & Google Play Services Messaging / Core
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-keepclassmembers class * {
    @com.google.firebase.firestore.PropertyName <fields>;
    @com.google.firebase.firestore.PropertyName <methods>;
}

# 6. JSON / HTTP Serialization (Gson / OkHttp / Kotlin)
-keep class com.google.gson.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
-dontwarn kotlin.**
-dontwarn kotlinx.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn com.getcapacitor.**
-dontwarn ee.forgr.**
-dontwarn androidx.biometric.**
-dontwarn androidx.work.**
-dontwarn com.google.firebase.**
