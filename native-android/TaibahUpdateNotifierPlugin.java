package net.taibah.wireless;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;

import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * TaibahUpdateNotifierPlugin
 *
 * Production-grade Capacitor 7 Android native OTA plugin for TAIBAH NET:
 * 1. Requests Android 13+ POST_NOTIFICATIONS permission gently after first login.
 * 2. Persists `currentBuildNumber` & `versionJsonUrl` and schedules WorkManager checks.
 * 3. Handles `OPEN_UPDATE_DIALOG=true` when the user taps the system update notification.
 * 4. Native Java Streaming-to-Disk OTA Engine (`downloadAndApplyOta` / `cancelOtaDownload`):
 *    - Runs strictly on a background ExecutorService (ZERO JS fetch / ZERO Base64 / ZERO memory spikes).
 *    - Strict 12s connect/read timeouts + 10s 0-KB/s stall watchdog that disconnects hung sockets immediately.
 *    - Manual cross-domain redirect resolution up to 5 hops (301/302/303/307/308) with `Accept-Encoding: identity`.
 *    - 16KB buffered direct disk writes (`update_part.zip`) with automatic `Range: bytes=<downloaded>-` HTTP 206 resume (up to 2 retries per mirror) and automatic mirror failover.
 *    - Throttled 200ms progress events (`otaDownloadProgress`) carrying downloadedBytes, totalBytes, percent, speedKbps, mirrorIndex, mirrorCount, mirrorLabel, and status.
 *    - Pre-apply integrity verification via `new ZipFile(partFile)` (validates entries + `index.html` + Zip Slip protection) before extracting & activating via Capacitor Bridge `setServerBasePath`.
 */
@CapacitorPlugin(
        name = "TaibahUpdateNotifier",
        permissions = {
                @Permission(
                        alias = "notifications",
                        strings = { Manifest.permission.POST_NOTIFICATIONS }
                )
        }
)
public class TaibahUpdateNotifierPlugin extends Plugin {

    private static final String PERIODIC_WORK_NAME = "taibah_periodic_update_check";
    private static final String IMMEDIATE_WORK_NAME = "taibah_immediate_update_check";

    private static final String KEY_ACTIVE_OTA_PATH = "activeOtaBundlePath";
    private static final String KEY_ACTIVE_OTA_BUILD = "activeOtaBundleBuild";
    private static final String KEY_ACTIVE_OTA_VERSION = "activeOtaBundleVersion";
    private static final String KEY_ACTIVE_OTA_NATIVE_BUILD = "activeOtaNativeBuild";
    private static final String CAP_WEBVIEW_PREFS = "CapWebViewSettings";
    private static final String CAP_SERVER_BASE_PATH_KEY = "serverBasePath";

    private static final int CONNECT_TIMEOUT_MS = 12000;
    private static final int READ_TIMEOUT_MS = 12000;
    private static final long STALL_TIMEOUT_MS = 10000L;
    private static final long PROGRESS_INTERVAL_MS = 200L;
    private static final int MAX_REDIRECT_HOPS = 5;
    private static final int MAX_RESUMES_PER_MIRROR = 2;
    private static final int STREAM_BUFFER_BYTES = 16 * 1024; // 16KB direct disk streaming buffer

    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService watchdogExecutor = Executors.newSingleThreadScheduledExecutor();

    private final AtomicBoolean downloadInProgress = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private final AtomicReference<HttpURLConnection> activeConnection = new AtomicReference<>(null);

    @Override
    public void load() {
        super.load();
        restoreActiveOtaBundleOnBoot();
        Activity activity = getActivity();
        if (activity != null) {
            captureUpdateIntent(activity.getIntent(), false);
        }
    }

    @Override
    protected void handleOnDestroy() {
        cancelRequested.set(true);
        disconnectActiveConnection();
        try {
            downloadExecutor.shutdownNow();
            watchdogExecutor.shutdownNow();
        } catch (Throwable ignored) {
            // Non-fatal
        }
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        captureUpdateIntent(intent, true);
    }

    /**
     * Restores a verified native OTA bundle on cold start unless a newer APK was installed.
     */
    private void restoreActiveOtaBundleOnBoot() {
        try {
            Context ctx = getContext();
            if (ctx == null) return;
            SharedPreferences prefs = ctx.getSharedPreferences(UpdateCheckWorker.PREFS_NAME, Context.MODE_PRIVATE);
            String savedPath = prefs.getString(KEY_ACTIVE_OTA_PATH, "");
            int savedBundleBuild = prefs.getInt(KEY_ACTIVE_OTA_BUILD, 0);
            int savedNativeBuild = prefs.getInt(KEY_ACTIVE_OTA_NATIVE_BUILD, 0);
            int currentNativeBuild = UpdateCheckWorker.resolveBuildConfigBuildNumber();

            if (savedPath == null || savedPath.trim().isEmpty()) {
                return;
            }

            // If user installed a newer APK than when this OTA bundle was applied, revert cleanly to built-in assets
            if (currentNativeBuild > 0 && (currentNativeBuild > savedNativeBuild || currentNativeBuild > savedBundleBuild)) {
                clearPersistedOtaBundle(ctx, prefs);
                return;
            }

            File bundleDir = new File(savedPath);
            File indexFile = new File(bundleDir, "index.html");
            if (!bundleDir.isDirectory() || !indexFile.isFile() || indexFile.length() <= 0L) {
                clearPersistedOtaBundle(ctx, prefs);
                return;
            }

            Bridge b = getBridge();
            if (b != null) {
                String currentPath = b.getServerBasePath();
                if (!savedPath.equals(currentPath)) {
                    b.setServerBasePath(savedPath);
                }
            }
        } catch (Throwable ignored) {
            // Fall back safely to built-in APK assets
        }
    }

    private void clearPersistedOtaBundle(Context ctx, SharedPreferences prefs) {
        try {
            prefs.edit()
                    .remove(KEY_ACTIVE_OTA_PATH)
                    .remove(KEY_ACTIVE_OTA_BUILD)
                    .remove(KEY_ACTIVE_OTA_VERSION)
                    .remove(KEY_ACTIVE_OTA_NATIVE_BUILD)
                    .apply();
            SharedPreferences capPrefs = ctx.getSharedPreferences(CAP_WEBVIEW_PREFS, Context.MODE_PRIVATE);
            if (capPrefs.contains(CAP_SERVER_BASE_PATH_KEY)) {
                capPrefs.edit().remove(CAP_SERVER_BASE_PATH_KEY).apply();
            }
        } catch (Throwable ignored) {
            // Non-fatal
        }
    }

    private void captureUpdateIntent(Intent intent, boolean emitEvent) {
        if (intent == null) return;
        boolean shouldOpen = intent.getBooleanExtra(UpdateCheckWorker.EXTRA_OPEN_UPDATE_DIALOG, false);
        if (!shouldOpen) return;

        // Clear extra so activity recreation does not re-trigger the dialog repeatedly
        intent.removeExtra(UpdateCheckWorker.EXTRA_OPEN_UPDATE_DIALOG);

        Context ctx = getContext();
        if (ctx != null) {
            SharedPreferences prefs = ctx.getSharedPreferences(UpdateCheckWorker.PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putBoolean(UpdateCheckWorker.KEY_PENDING_OPEN_DIALOG, true).apply();
        }

        if (emitEvent) {
            JSObject payload = new JSObject();
            payload.put("openUpdateDialog", true);
            notifyListeners("openUpdateDialog", payload, true);
        }
    }

    @PluginMethod
    public void getBuildConfig(PluginCall call) {
        JSObject out = new JSObject();
        out.put("githubRepo", UpdateCheckWorker.resolveBuildConfigRepo());
        out.put("appBuildNumber", UpdateCheckWorker.resolveBuildConfigBuildNumber());
        out.put("versionJsonUrl", UpdateCheckWorker.resolveDefaultVersionUrl());
        call.resolve(out);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        try {
            Context ctx = getContext();
            if (ctx == null) {
                call.resolve(new JSObject().put("scheduled", false));
                return;
            }

            int currentBuild = call.getInt("currentBuildNumber", 0);
            int nativeBuild = UpdateCheckWorker.resolveBuildConfigBuildNumber();
            if (nativeBuild > currentBuild) {
                currentBuild = nativeBuild;
            }

            String versionUrl = call.getString("versionJsonUrl", "");
            if (versionUrl == null || versionUrl.trim().isEmpty()) {
                versionUrl = UpdateCheckWorker.resolveDefaultVersionUrl();
            }
            boolean triggerImmediate = Boolean.TRUE.equals(call.getBoolean("checkNow", false));

            SharedPreferences prefs = ctx.getSharedPreferences(UpdateCheckWorker.PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            if (currentBuild > 0) {
                editor.putInt(UpdateCheckWorker.KEY_CURRENT_BUILD, currentBuild);
                int lastNotified = prefs.getInt(UpdateCheckWorker.KEY_LAST_NOTIFIED_BUILD, 0);
                if (currentBuild >= lastNotified) {
                    clearNotificationInternal(ctx);
                }
            }
            if (versionUrl != null && !versionUrl.trim().isEmpty()) {
                editor.putString(UpdateCheckWorker.KEY_VERSION_URL, versionUrl.trim());
            }
            editor.apply();

            Constraints constraints = new Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build();

            PeriodicWorkRequest periodicRequest = new PeriodicWorkRequest.Builder(
                    UpdateCheckWorker.class,
                    2,
                    TimeUnit.HOURS
            )
                    .setConstraints(constraints)
                    .build();

            WorkManager wm = WorkManager.getInstance(ctx);
            wm.enqueueUniquePeriodicWork(
                    PERIODIC_WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    periodicRequest
            );

            if (triggerImmediate && versionUrl != null && !versionUrl.trim().isEmpty()) {
                OneTimeWorkRequest immediateRequest = new OneTimeWorkRequest.Builder(UpdateCheckWorker.class)
                        .setConstraints(constraints)
                        .build();
                wm.enqueueUniqueWork(
                        IMMEDIATE_WORK_NAME,
                        ExistingWorkPolicy.REPLACE,
                        immediateRequest
                );
            }

            JSObject out = new JSObject();
            out.put("scheduled", true);
            out.put("githubRepo", UpdateCheckWorker.resolveBuildConfigRepo());
            call.resolve(out);
        } catch (Throwable t) {
            JSObject out = new JSObject();
            out.put("scheduled", false);
            out.put("error", t.getMessage());
            call.resolve(out);
        }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }

        Context ctx = getContext();
        if (ctx != null && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }

        try {
            requestPermissionForAlias("notifications", call, "notificationsPermissionCallback");
        } catch (Throwable t) {
            JSObject out = new JSObject();
            out.put("granted", false);
            call.resolve(out);
        }
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        boolean granted = getPermissionState("notifications") == PermissionState.GRANTED;
        JSObject out = new JSObject();
        out.put("granted", granted);
        call.resolve(out);
    }

    @PluginMethod
    public void checkPendingUpdateIntent(PluginCall call) {
        boolean openDialog = false;
        try {
            Activity activity = getActivity();
            if (activity != null) {
                captureUpdateIntent(activity.getIntent(), false);
            }
            Context ctx = getContext();
            if (ctx != null) {
                SharedPreferences prefs = ctx.getSharedPreferences(UpdateCheckWorker.PREFS_NAME, Context.MODE_PRIVATE);
                openDialog = prefs.getBoolean(UpdateCheckWorker.KEY_PENDING_OPEN_DIALOG, false);
                if (openDialog) {
                    prefs.edit().putBoolean(UpdateCheckWorker.KEY_PENDING_OPEN_DIALOG, false).apply();
                }
            }
        } catch (Throwable ignored) {
            openDialog = false;
        }

        JSObject out = new JSObject();
        out.put("openUpdateDialog", openDialog);
        call.resolve(out);
    }

    @PluginMethod
    public void clearUpdateNotification(PluginCall call) {
        try {
            Context ctx = getContext();
            if (ctx != null) {
                int appliedBuild = call.getInt("buildNumber", 0);
                SharedPreferences prefs = ctx.getSharedPreferences(UpdateCheckWorker.PREFS_NAME, Context.MODE_PRIVATE);
                SharedPreferences.Editor editor = prefs.edit();
                if (appliedBuild > 0) {
                    editor.putInt(UpdateCheckWorker.KEY_CURRENT_BUILD, appliedBuild);
                    editor.putInt(UpdateCheckWorker.KEY_LAST_NOTIFIED_BUILD, appliedBuild);
                }
                editor.putBoolean(UpdateCheckWorker.KEY_PENDING_OPEN_DIALOG, false);
                editor.apply();
                clearNotificationInternal(ctx);
            }
            call.resolve(new JSObject().put("cleared", true));
        } catch (Throwable ignored) {
            call.resolve(new JSObject().put("cleared", false));
        }
    }

    /**
     * Immediately aborts any running native OTA download socket and cleans temporary bytes.
     */
    @PluginMethod
    public void cancelOtaDownload(PluginCall call) {
        cancelRequested.set(true);
        disconnectActiveConnection();
        JSObject out = new JSObject();
        out.put("cancelled", true);
        call.resolve(out);
    }

    /**
     * Ultra-fast native Java streaming-to-disk OTA downloader & activator:
     * - Streams directly to disk in 16KB chunks on a background ExecutorService
     * - Strict 12s connect/read timeouts + 10s 0-KB/s stall watchdog
     * - Manual redirect following up to 5 hops across domains
     * - Automatic HTTP 206 Range resume (up to 2 retries per mirror) + automatic mirror failover
     * - Verifies ZIP structure & `index.html` via `new ZipFile(partFile)` before extracting & activating
     */
    @PluginMethod
    public void downloadAndApplyOta(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            JSObject out = new JSObject();
            out.put("applied", false);
            out.put("error", "تعذر الوصول إلى نظام ملفات الهاتف.");
            call.resolve(out);
            return;
        }

        List<String> mirrors = new ArrayList<>();
        try {
            JSArray arr = call.getArray("urls");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    String u = arr.optString(i, "").trim();
                    if ((u.startsWith("https://") || u.startsWith("http://")) && !mirrors.contains(u)) {
                        mirrors.add(u);
                    }
                }
            }
        } catch (Throwable ignored) {
            // Fall back to single url field below
        }

        String singleUrl = call.getString("url", "");
        if (singleUrl != null) {
            String trimmed = singleUrl.trim();
            if ((trimmed.startsWith("https://") || trimmed.startsWith("http://")) && !mirrors.contains(trimmed)) {
                mirrors.add(trimmed);
            }
        }

        if (mirrors.isEmpty()) {
            JSObject out = new JSObject();
            out.put("applied", false);
            out.put("error", "لا توجد روابط مرايا صالحة لتحميل حزمة التحديث.");
            call.resolve(out);
            return;
        }

        if (!downloadInProgress.compareAndSet(false, true)) {
            JSObject out = new JSObject();
            out.put("applied", false);
            out.put("error", "يوجد تحميل تحديث جارٍ حالياً بالفعل.");
            call.resolve(out);
            return;
        }

        cancelRequested.set(false);
        final String targetVersion = call.getString("version", "").trim();
        final int targetBuild = call.getInt("buildNumber", 0);
        final long expectedBytes = call.getLong("expectedBytes", 0L);

        downloadExecutor.execute(() -> {
            File workDir = new File(ctx.getCacheDir(), "taibah_ota_tmp");
            if (!workDir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                workDir.mkdirs();
            }
            File partFile = new File(workDir, "update_part.zip");
            String lastErrorReason = "تعذر الاتصال بجميع سيرفرات التحديث.";

            try {
                int mirrorCount = mirrors.size();
                boolean downloadedOk = false;
                int succeededMirrorIndex = 0;

                for (int mIdx = 0; mIdx < mirrorCount; mIdx++) {
                    if (cancelRequested.get()) {
                        break;
                    }

                    // Always reset partial file when switching to a different mirror
                    deleteQuietly(partFile);

                    String mirrorUrl = mirrors.get(mIdx);
                    int displayMirrorNum = mIdx + 1;
                    String mirrorLabel = detectMirrorLabel(mirrorUrl, displayMirrorNum);

                    emitProgress(0L, expectedBytes, 1, 0.0, displayMirrorNum, mirrorCount, mirrorLabel, "downloading");

                    for (int attempt = 0; attempt <= MAX_RESUMES_PER_MIRROR; attempt++) {
                        if (cancelRequested.get()) {
                            break;
                        }
                        try {
                            long existing = partFile.isFile() ? partFile.length() : 0L;
                            downloadMirrorStream(
                                    mirrorUrl,
                                    partFile,
                                    existing,
                                    expectedBytes,
                                    displayMirrorNum,
                                    mirrorCount,
                                    mirrorLabel
                            );

                            if (cancelRequested.get()) {
                                break;
                            }

                            // Verify ZIP integrity immediately before declaring success
                            emitProgress(partFile.length(), partFile.length(), 96, 0.0, displayMirrorNum, mirrorCount, mirrorLabel, "verifying");
                            verifyZipIntegrity(partFile);

                            downloadedOk = true;
                            succeededMirrorIndex = displayMirrorNum;
                            break;
                        } catch (CancelledException ce) {
                            cancelRequested.set(true);
                            break;
                        } catch (Throwable mirrorErr) {
                            String msg = mirrorErr.getMessage();
                            if (msg == null || msg.trim().isEmpty()) {
                                msg = mirrorErr.getClass().getSimpleName();
                            }
                            lastErrorReason = mirrorLabel + ": " + msg;
                            // If verification failed (corrupt ZIP), don't resume broken bytes — switch mirror
                            if (mirrorErr instanceof CorruptZipException) {
                                deleteQuietly(partFile);
                                break;
                            }
                            // Otherwise loop will automatically resume from partFile.length() via Range header
                        }
                    }

                    if (downloadedOk || cancelRequested.get()) {
                        break;
                    }
                }

                if (cancelRequested.get()) {
                    deleteQuietly(partFile);
                    JSObject out = new JSObject();
                    out.put("applied", false);
                    out.put("cancelled", true);
                    out.put("error", "تم إلغاء تحميل التحديث.");
                    call.resolve(out);
                    return;
                }

                if (!downloadedOk) {
                    deleteQuietly(partFile);
                    JSObject out = new JSObject();
                    out.put("applied", false);
                    out.put("cancelled", false);
                    out.put("error", "فشلت جميع سيرفرات التحديث (" + lastErrorReason + ") — يرجى المحاولة مجدداً.");
                    call.resolve(out);
                    return;
                }

                // Extract verified ZIP safely into persistent versioned directory
                String label = detectMirrorLabel(mirrors.get(Math.max(0, succeededMirrorIndex - 1)), succeededMirrorIndex);
                emitProgress(partFile.length(), partFile.length(), 98, 0.0, succeededMirrorIndex, mirrorCount, label, "extracting");

                File bundlesRoot = new File(ctx.getFilesDir(), "taibah_ota_bundles");
                if (!bundlesRoot.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    bundlesRoot.mkdirs();
                }

                String dirName = "b_" + (targetBuild > 0 ? targetBuild : 0) + "_" + System.currentTimeMillis();
                File extractDir = new File(bundlesRoot, dirName);
                File bundleRoot = extractVerifiedZip(partFile, extractDir);

                // Clean up temporary archive after successful extraction
                deleteQuietly(partFile);

                // Persist active OTA bundle metadata and Capacitor serverBasePath
                SharedPreferences prefs = ctx.getSharedPreferences(UpdateCheckWorker.PREFS_NAME, Context.MODE_PRIVATE);
                SharedPreferences.Editor editor = prefs.edit();
                editor.putString(KEY_ACTIVE_OTA_PATH, bundleRoot.getAbsolutePath());
                editor.putInt(KEY_ACTIVE_OTA_BUILD, targetBuild);
                editor.putString(KEY_ACTIVE_OTA_VERSION, targetVersion);
                editor.putInt(KEY_ACTIVE_OTA_NATIVE_BUILD, UpdateCheckWorker.resolveBuildConfigBuildNumber());
                if (targetBuild > 0) {
                    editor.putInt(UpdateCheckWorker.KEY_CURRENT_BUILD, targetBuild);
                    editor.putInt(UpdateCheckWorker.KEY_LAST_NOTIFIED_BUILD, targetBuild);
                }
                editor.putBoolean(UpdateCheckWorker.KEY_PENDING_OPEN_DIALOG, false);
                editor.apply();

                SharedPreferences capPrefs = ctx.getSharedPreferences(CAP_WEBVIEW_PREFS, Context.MODE_PRIVATE);
                capPrefs.edit().putString(CAP_SERVER_BASE_PATH_KEY, bundleRoot.getAbsolutePath()).apply();

                clearNotificationInternal(ctx);
                pruneOldBundles(bundlesRoot, extractDir.getName());

                emitProgress(100L, 100L, 100, 0.0, succeededMirrorIndex, mirrorCount, label, "applying");

                // Resolve JS call FIRST, then seamlessly switch WebView base path on the UI thread
                JSObject out = new JSObject();
                out.put("applied", true);
                out.put("version", targetVersion);
                out.put("buildNumber", targetBuild);
                out.put("mirrorIndex", succeededMirrorIndex);
                call.resolve(out);

                final String finalBundlePath = bundleRoot.getAbsolutePath();
                Activity activity = getActivity();
                Bridge b = getBridge();
                if (activity != null && b != null) {
                    activity.runOnUiThread(() -> {
                        try {
                            b.setServerBasePath(finalBundlePath);
                            if (b.getWebView() != null) {
                                b.getWebView().post(() -> {
                                    try {
                                        b.getWebView().loadUrl(b.getAppUrl());
                                        b.getWebView().clearHistory();
                                    } catch (Throwable ignored) {
                                        // Non-fatal
                                    }
                                });
                            }
                        } catch (Throwable ignored) {
                            // Will automatically activate on next app launch via CapWebViewSettings
                        }
                    });
                }
            } catch (Throwable t) {
                deleteQuietly(partFile);
                JSObject out = new JSObject();
                out.put("applied", false);
                out.put("cancelled", cancelRequested.get());
                out.put("error", t.getMessage() != null ? t.getMessage() : "تعذر تثبيت حزمة التحديث.");
                call.resolve(out);
            } finally {
                disconnectActiveConnection();
                downloadInProgress.set(false);
            }
        });
    }

    private void downloadMirrorStream(
            String initialUrl,
            File partFile,
            long existingBytes,
            long expectedBytes,
            int mirrorIndex,
            int mirrorCount,
            String mirrorLabel
    ) throws Exception {
        String currentUrl = initialUrl;
        HttpURLConnection conn = null;
        ScheduledFuture<?> stallTask = null;

        try {
            int responseCode = -1;
            for (int hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
                if (cancelRequested.get()) {
                    throw new CancelledException();
                }

                URL url = new URL(currentUrl);
                conn = (HttpURLConnection) url.openConnection();
                activeConnection.set(conn);

                conn.setRequestMethod("GET");
                conn.setInstanceFollowRedirects(false); // Manual cross-domain redirect handling
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setUseCaches(false);
                conn.setRequestProperty("User-Agent", "TaibahNet-Android");
                conn.setRequestProperty("Accept-Encoding", "identity");
                conn.setRequestProperty("Cache-Control", "no-cache");

                if (existingBytes > 0L) {
                    conn.setRequestProperty("Range", "bytes=" + existingBytes + "-");
                }

                responseCode = conn.getResponseCode();
                if (responseCode == HttpURLConnection.HTTP_MOVED_PERM
                        || responseCode == HttpURLConnection.HTTP_MOVED_TEMP
                        || responseCode == HttpURLConnection.HTTP_SEE_OTHER
                        || responseCode == 307
                        || responseCode == 308) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    activeConnection.compareAndSet(conn, null);
                    conn = null;
                    if (location == null || location.trim().isEmpty()) {
                        throw new IOException("رابط إعادة توجيه فارغ (HTTP " + responseCode + ")");
                    }
                    currentUrl = new URL(url, location.trim()).toString();
                    continue;
                }
                break;
            }

            if (conn == null) {
                throw new IOException("تجاوز الحد الأقصى لإعادة التوجيه");
            }

            // HTTP 416 Range Not Satisfiable — check if file is already complete, else restart from 0
            if (responseCode == 416 && existingBytes > 0L) {
                conn.disconnect();
                activeConnection.compareAndSet(conn, null);
                try {
                    verifyZipIntegrity(partFile);
                    return; // Already complete!
                } catch (Throwable ignored) {
                    deleteQuietly(partFile);
                    throw new IOException("إعادة بدء التحميل من البداية");
                }
            }

            boolean appendMode;
            long downloaded;
            long totalBytes;

            if (responseCode == HttpURLConnection.HTTP_PARTIAL && existingBytes > 0L) {
                appendMode = true;
                downloaded = existingBytes;
                long contentLen = getContentLengthSafe(conn);
                long rangeTotal = parseTotalFromContentRange(conn.getHeaderField("Content-Range"));
                if (rangeTotal > 0L) {
                    totalBytes = rangeTotal;
                } else if (contentLen > 0L) {
                    totalBytes = existingBytes + contentLen;
                } else {
                    totalBytes = expectedBytes;
                }
            } else if (responseCode >= 200 && responseCode < 300) {
                appendMode = false;
                downloaded = 0L;
                long contentLen = getContentLengthSafe(conn);
                totalBytes = contentLen > 0L ? contentLen : expectedBytes;
            } else {
                throw new IOException("استجابة السيرفر غير صالحة (HTTP " + responseCode + ")");
            }

            final HttpURLConnection watchedConn = conn;
            final AtomicLong lastDataAt = new AtomicLong(SystemClock.elapsedRealtime());
            final AtomicBoolean stalledFlag = new AtomicBoolean(false);

            // 10-second 0-KB/s stall watchdog: disconnects hung socket immediately
            stallTask = watchdogExecutor.scheduleAtFixedRate(() -> {
                if (cancelRequested.get()) {
                    try {
                        watchedConn.disconnect();
                    } catch (Throwable ignored) {
                        // ignore
                    }
                    return;
                }
                long idleMs = SystemClock.elapsedRealtime() - lastDataAt.get();
                if (idleMs >= STALL_TIMEOUT_MS) {
                    stalledFlag.set(true);
                    try {
                        watchedConn.disconnect();
                    } catch (Throwable ignored) {
                        // ignore
                    }
                }
            }, 1, 1, TimeUnit.SECONDS);

            byte[] buffer = new byte[STREAM_BUFFER_BYTES];
            long lastEmitAt = SystemClock.elapsedRealtime();
            long windowStartAt = lastEmitAt;
            long windowBytes = 0L;

            try (InputStream in = new BufferedInputStream(conn.getInputStream(), STREAM_BUFFER_BYTES);
                 BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(partFile, appendMode), STREAM_BUFFER_BYTES)) {

                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (cancelRequested.get()) {
                        throw new CancelledException();
                    }
                    if (read > 0) {
                        out.write(buffer, 0, read);
                        downloaded += read;
                        windowBytes += read;
                        long now = SystemClock.elapsedRealtime();
                        lastDataAt.set(now);

                        if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
                            long elapsedMs = Math.max(1L, now - windowStartAt);
                            double speedKbps = (windowBytes / 1024.0) / (elapsedMs / 1000.0);
                            int pct = computePercent(downloaded, totalBytes);
                            emitProgress(downloaded, totalBytes, pct, speedKbps, mirrorIndex, mirrorCount, mirrorLabel, "downloading");
                            lastEmitAt = now;
                            // Smooth sliding speed window every 1.2s
                            if (elapsedMs >= 1200L) {
                                windowStartAt = now;
                                windowBytes = 0L;
                            }
                        }
                    }
                }
                out.flush();
            } catch (IOException ioErr) {
                if (cancelRequested.get()) {
                    throw new CancelledException();
                }
                if (stalledFlag.get()) {
                    throw new IOException("توقف تدفق البيانات لمدة 10 ثوانٍ (0 KB/s)");
                }
                throw ioErr;
            }

            if (totalBytes > 0L && downloaded < totalBytes) {
                throw new IOException("انقطع التحميل قبل الاكتمال (" + downloaded + "/" + totalBytes + ")");
            }
            if (downloaded <= 0L) {
                throw new IOException("الملف المستلم فارغ");
            }

            emitProgress(downloaded, Math.max(downloaded, totalBytes), 95, 0.0, mirrorIndex, mirrorCount, mirrorLabel, "downloading");
        } finally {
            if (stallTask != null) {
                stallTask.cancel(true);
            }
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Throwable ignored) {
                    // ignore
                }
                activeConnection.compareAndSet(conn, null);
            }
        }
    }

    /**
     * Strictly verifies the downloaded ZIP archive via `new ZipFile(file)` BEFORE extracting or applying:
     * ensures valid central directory, non-empty entries, presence & readability of `index.html`.
     */
    private void verifyZipIntegrity(File zipFile) throws CorruptZipException {
        if (zipFile == null || !zipFile.isFile() || zipFile.length() < 128L) {
            throw new CorruptZipException("حزمة التحديث غير مكتملة أو صغيرة جداً.");
        }
        try (ZipFile zf = new ZipFile(zipFile)) {
            if (zf.size() <= 0) {
                throw new CorruptZipException("حزمة التحديث فارغة.");
            }
            ZipEntry indexEntry = null;
            Enumeration<? extends ZipEntry> entries = zf.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String name = entry.getName();
                if (name == null) continue;
                if (name.contains("..")) {
                    throw new CorruptZipException("مسار غير آمن داخل حزمة التحديث.");
                }
                if (!entry.isDirectory()) {
                    String normalized = name.replace("\\", "/");
                    if ("index.html".equals(normalized) || normalized.endsWith("/index.html")) {
                        if (indexEntry == null || normalized.length() < indexEntry.getName().length()) {
                            indexEntry = entry;
                        }
                    }
                }
            }
            if (indexEntry == null) {
                throw new CorruptZipException("ملف index.html غير موجود داخل حزمة التحديث.");
            }
            // Verify index.html entry decompresses cleanly (CRC check)
            try (InputStream is = zf.getInputStream(indexEntry)) {
                byte[] buf = new byte[4096];
                int total = 0;
                int r;
                while ((r = is.read(buf)) != -1) {
                    total += r;
                }
                if (total <= 0) {
                    throw new CorruptZipException("ملف index.html داخل التحديث فارغ.");
                }
            }
        } catch (CorruptZipException cze) {
            throw cze;
        } catch (Throwable t) {
            throw new CorruptZipException("ملف التحديث تالف أو غير مكتمل: " + (t.getMessage() != null ? t.getMessage() : "ZIP error"));
        }
    }

    /**
     * Safely extracts verified ZIP into `destDir` with Zip Slip canonical path guard
     * and returns the directory containing `index.html`.
     */
    private File extractVerifiedZip(File zipFile, File destDir) throws IOException {
        if (!destDir.exists() && !destDir.mkdirs()) {
            throw new IOException("تعذر إنشاء مجلد استخراج التحديث.");
        }
        String canonicalDest = destDir.getCanonicalPath() + File.separator;
        File discoveredRoot = null;

        try (ZipFile zf = new ZipFile(zipFile)) {
            Enumeration<? extends ZipEntry> entries = zf.entries();
            byte[] buffer = new byte[STREAM_BUFFER_BYTES];

            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String entryName = entry.getName();
                if (entryName == null || entryName.trim().isEmpty()) continue;

                File outFile = new File(destDir, entryName);
                String canonicalOut = outFile.getCanonicalPath();
                if (!canonicalOut.startsWith(canonicalDest)) {
                    throw new IOException("تم رفض مسار غير آمن أثناء فك الضغط.");
                }

                if (entry.isDirectory()) {
                    if (!outFile.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        outFile.mkdirs();
                    }
                    continue;
                }

                File parent = outFile.getParentFile();
                if (parent != null && !parent.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    parent.mkdirs();
                }

                try (InputStream in = zf.getInputStream(entry);
                     BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(outFile), STREAM_BUFFER_BYTES)) {
                    int r;
                    while ((r = in.read(buffer)) != -1) {
                        out.write(buffer, 0, r);
                    }
                    out.flush();
                }

                if ("index.html".equals(outFile.getName())) {
                    if (discoveredRoot == null || outFile.getParentFile().getAbsolutePath().length() < discoveredRoot.getAbsolutePath().length()) {
                        discoveredRoot = outFile.getParentFile();
                    }
                }
            }
        }

        if (discoveredRoot == null || !new File(discoveredRoot, "index.html").isFile()) {
            deleteRecursive(destDir);
            throw new IOException("تعذر العثور على index.html بعد فك ضغط التحديث.");
        }
        return discoveredRoot;
    }

    private void emitProgress(
            long downloadedBytes,
            long totalBytes,
            int percent,
            double speedKbps,
            int mirrorIndex,
            int mirrorCount,
            String mirrorLabel,
            String status
    ) {
        try {
            JSObject payload = new JSObject();
            payload.put("downloadedBytes", downloadedBytes);
            payload.put("totalBytes", totalBytes);
            payload.put("percent", Math.max(0, Math.min(100, percent)));
            payload.put("speedKbps", Math.round(Math.max(0.0, speedKbps) * 10.0) / 10.0);
            payload.put("mirrorIndex", mirrorIndex);
            payload.put("mirrorCount", mirrorCount);
            payload.put("mirrorLabel", mirrorLabel);
            payload.put("status", status);
            notifyListeners("otaDownloadProgress", payload, false);
        } catch (Throwable ignored) {
            // Non-fatal UI notification error
        }
    }

    private static int computePercent(long downloaded, long total) {
        if (total <= 0L) {
            return Math.min(90, Math.max(5, (int) ((downloaded / 10240L) % 85) + 5));
        }
        int pct = (int) Math.round((downloaded * 94.0) / total);
        return Math.max(1, Math.min(95, pct));
    }

    private static long getContentLengthSafe(HttpURLConnection conn) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            return conn.getContentLengthLong();
        }
        String header = conn.getHeaderField("Content-Length");
        if (header != null) {
            try {
                return Long.parseLong(header.trim());
            } catch (NumberFormatException ignored) {
                // fall through
            }
        }
        return conn.getContentLength();
    }

    private static long parseTotalFromContentRange(String contentRange) {
        if (contentRange == null) return -1L;
        int slash = contentRange.lastIndexOf('/');
        if (slash < 0 || slash + 1 >= contentRange.length()) return -1L;
        String totalStr = contentRange.substring(slash + 1).trim();
        if ("*".equals(totalStr)) return -1L;
        try {
            return Long.parseLong(totalStr);
        } catch (NumberFormatException ignored) {
            return -1L;
        }
    }

    private static String detectMirrorLabel(String url, int index) {
        String lower = url != null ? url.toLowerCase(Locale.US) : "";
        if (lower.contains("jsdelivr.net")) return "jsDelivr CDN السريع";
        if (lower.contains("raw.githubusercontent.com")) return "GitHub Raw المباشر";
        if (lower.contains("github.com")) return "GitHub Releases الرسمي";
        return "سيرفر التحديث #" + index;
    }

    private void disconnectActiveConnection() {
        HttpURLConnection c = activeConnection.getAndSet(null);
        if (c != null) {
            try {
                c.disconnect();
            } catch (Throwable ignored) {
                // Non-fatal
            }
        }
    }

    private void pruneOldBundles(File bundlesRoot, String keepDirName) {
        try {
            File[] children = bundlesRoot.listFiles();
            if (children == null) return;
            for (File child : children) {
                if (child != null && !child.getName().equals(keepDirName)) {
                    deleteRecursive(child);
                }
            }
        } catch (Throwable ignored) {
            // Non-fatal cleanup
        }
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private static void deleteRecursive(File target) {
        if (target == null || !target.exists()) return;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) {
                for (File c : children) {
                    deleteRecursive(c);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        target.delete();
    }

    private void clearNotificationInternal(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(UpdateCheckWorker.NOTIFICATION_ID);
            }
        } catch (Throwable ignored) {
            // Non-fatal
        }
    }

    private static class CancelledException extends Exception {
        CancelledException() {
            super("cancelled");
        }
    }

    private static class CorruptZipException extends Exception {
        CorruptZipException(String message) {
            super(message);
        }
    }
}
