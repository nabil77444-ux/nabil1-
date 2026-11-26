package net.taibah.wireless;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * UpdateCheckWorker
 *
 * Periodic background Android WorkManager worker for TAIBAH NET (كروت طيبة نت).
 * - Runs every 2 hours (when NetworkType.CONNECTED) even while the app is closed.
 * - Downloads only the tiny `version.json` (~300 bytes) via HttpURLConnection.
 * - Compares remote `buildNumber` with local `currentBuildNumber` in SharedPreferences.
 * - Shows a single high-priority Android status bar notification per new buildNumber
 *   displaying the exact lightweight OTA size (`updateSizeText`).
 * - Tapping the notification opens MainActivity with `OPEN_UPDATE_DIALOG = true`.
 */
public class UpdateCheckWorker extends Worker {

    public static final String PREFS_NAME = "taibah_ota_prefs";
    public static final String KEY_CURRENT_BUILD = "currentBuildNumber";
    public static final String KEY_VERSION_URL = "versionJsonUrl";
    public static final String KEY_LAST_NOTIFIED_BUILD = "lastNotifiedBuild";
    public static final String KEY_PENDING_OPEN_DIALOG = "pendingOpenUpdateDialog";

    public static final String CHANNEL_ID = "taibah_updates_channel";
    public static final int NOTIFICATION_ID = 772466;
    public static final String EXTRA_OPEN_UPDATE_DIALOG = "OPEN_UPDATE_DIALOG";

    public UpdateCheckWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        String versionUrl = prefs.getString(KEY_VERSION_URL, "");
        int currentBuild = prefs.getInt(KEY_CURRENT_BUILD, 0);
        int lastNotifiedBuild = prefs.getInt(KEY_LAST_NOTIFIED_BUILD, 0);

        if (versionUrl == null || versionUrl.trim().isEmpty()) {
            return Result.success();
        }

        try {
            String sep = versionUrl.contains("?") ? "&" : "?";
            String fetchUrl = versionUrl.trim() + sep + "t=" + System.currentTimeMillis();
            String jsonRaw = fetchTextFollowingRedirects(fetchUrl, 5);
            if (jsonRaw == null || jsonRaw.trim().isEmpty()) {
                return Result.retry();
            }

            JSONObject json = new JSONObject(jsonRaw);
            int remoteBuild = json.optInt("buildNumber", 0);
            String remoteVersion = json.optString("version", "").trim();
            String updateSizeText = json.optString("updateSizeText", "").trim();

            if (updateSizeText.isEmpty()) {
                long sizeBytes = json.optLong("updateSizeBytes", 0L);
                if (sizeBytes > 0L) {
                    updateSizeText = formatBytesArabic(sizeBytes);
                } else {
                    double sizeMb = json.optDouble("sizeMb", 0.0);
                    if (sizeMb > 0.0) {
                        updateSizeText = sizeMb < 1.0
                                ? Math.max(1, Math.round(sizeMb * 1024.0)) + " كيلوبايت"
                                : String.format(java.util.Locale.US, "%.1f ميجابايت", sizeMb);
                    } else {
                        updateSizeText = "خفيف جداً";
                    }
                }
            }

            if (remoteBuild > 0 && remoteBuild > currentBuild && remoteBuild > lastNotifiedBuild) {
                showUpdateNotification(context, remoteVersion, updateSizeText);
                prefs.edit().putInt(KEY_LAST_NOTIFIED_BUILD, remoteBuild).apply();
            }

            return Result.success();
        } catch (Throwable ignored) {
            return Result.retry();
        }
    }

    private String fetchTextFollowingRedirects(String urlStr, int maxRedirects) throws Exception {
        String current = urlStr;
        for (int hop = 0; hop <= maxRedirects; hop++) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(current);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setUseCaches(false);
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("Cache-Control", "no-cache");

                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM
                        || code == HttpURLConnection.HTTP_MOVED_TEMP
                        || code == HttpURLConnection.HTTP_SEE_OTHER
                        || code == 307
                        || code == 308) {
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) {
                        return null;
                    }
                    current = new URL(url, location).toString();
                    continue;
                }

                if (code < 200 || code >= 300) {
                    return null;
                }

                StringBuilder sb = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
                )) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                }
                return sb.toString();
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }
        return null;
    }

    private void showUpdateNotification(Context context, String version, String sizeText) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            int perm = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS);
            if (perm != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "تحديثات تطبيق كروت طيبة نت",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("إشعارات التحديثات الخفيفة الفورية لتطبيق كروت طيبة نت");
            channel.enableVibration(true);
            nm.createNotificationChannel(channel);
        }

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        launchIntent.putExtra(EXTRA_OPEN_UPDATE_DIALOG, true);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                NOTIFICATION_ID,
                launchIntent,
                pendingFlags
        );

        String verLabel = version.startsWith("v") || version.startsWith("V") ? version : ("v" + version);
        String title = "تحديث جديد لتطبيق كروت طيبة نت";
        String body = "الإصدار " + verLabel + " جاهز — حجم التحديث: " + sizeText
                + " فقط (بدون تحميل التطبيق بالكامل). اضغط للتحميل.";

        int smallIcon = context.getApplicationInfo().icon;
        if (smallIcon == 0) {
            smallIcon = android.R.drawable.stat_sys_download_done;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(smallIcon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setAutoCancel(true)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setContentIntent(contentIntent);

        nm.notify(NOTIFICATION_ID, builder.build());
    }

    private String formatBytesArabic(long bytes) {
        if (bytes < 1024L * 1024L) {
            long kb = Math.max(1L, Math.round(bytes / 1024.0));
            return kb + " كيلوبايت";
        }
        double mb = bytes / (1024.0 * 1024.0);
        return String.format(java.util.Locale.US, "%.1f ميجابايت", mb);
    }
}
