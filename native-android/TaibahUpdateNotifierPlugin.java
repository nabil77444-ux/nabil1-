package net.taibah.wireless;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.TimeUnit;

/**
 * TaibahUpdateNotifierPlugin
 *
 * Lightweight Capacitor 7 Android plugin that:
 * 1. Requests Android 13+ POST_NOTIFICATIONS permission gently after first login.
 * 2. Persists `currentBuildNumber` and `versionJsonUrl` in SharedPreferences and schedules
 *    periodic (2h) + immediate WorkManager checks via UpdateCheckWorker.
 * 3. Detects `OPEN_UPDATE_DIALOG=true` when the user taps the system notification and
 *    notifies the WebView to immediately display the OTA download modal.
 * 4. Clears the update notification once the lightweight OTA bundle is applied.
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

    @Override
    public void load() {
        super.load();
        Activity activity = getActivity();
        if (activity != null) {
            captureUpdateIntent(activity.getIntent(), false);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        captureUpdateIntent(intent, true);
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
    public void configure(PluginCall call) {
        try {
            Context ctx = getContext();
            if (ctx == null) {
                call.resolve(new JSObject().put("scheduled", false));
                return;
            }

            int currentBuild = call.getInt("currentBuildNumber", 0);
            String versionUrl = call.getString("versionJsonUrl", "");
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
}
