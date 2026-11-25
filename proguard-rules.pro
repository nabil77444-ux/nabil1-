# ==============================================================================
# Taibah Net Cards (كروت طيبة نت) — Android Release R8 / ProGuard Rules
# Safely shrinks APK size while preserving Capacitor 7, Native Plugins,
# AndroidX BiometricPrompt, Contacts, OTA Updater, Firebase & WebView Bridges.
# ==============================================================================

-optimizationpasses 3
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# Preserve annotations, generics, and native entry points
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions

# 1. Capacitor 7 Core & Plugin Bridge
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 2. Capgo Capacitor Updater (OTA Live Updates)
-keep class ee.forgr.capacitor_updater.** { *; }
-keep class app.capgo.** { *; }

# 3. Capgo Native Biometric + AndroidX BiometricPrompt & Hardware Keystore
-keep class ee.forgr.biometric.** { *; }
-keep class com.epicshaggy.biometric.** { *; }
-keep class androidx.biometric.** { *; }
-keep class androidx.security.crypto.** { *; }

# 4. Official Capacitor Plugins (Contacts, App, Filesystem, Share, StatusBar, Push, Haptics)
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
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
-dontwarn kotlin.**
-dontwarn kotlinx.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn com.getcapacitor.**
-dontwarn ee.forgr.**
-dontwarn com.google.firebase.**
