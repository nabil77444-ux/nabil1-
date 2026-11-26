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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * UpdateCheckWorker
 *
 * Periodic background Android WorkManager worker for TAIBAH NET (كروت طيبة نت).
 * - Runs every 2 hours (when NetworkType.CONNECTED) even while the app is closed.
 * - Uses BuildConfig.GITHUB_REPO (auto-injected by GitHub Actions / Gradle) with SharedPreferences override.
 * - Stage 1: Downloads `https://github.com/<REPO>/releases/latest/download/version.json` following
 *   cross-domain 301/302/303/307/308 redirects (github.com -> objects.githubusercontent.com).
 * - Stage 2 (404 fallback): Queries `https://api.github.com/repos/<REPO>/releases?per_page=1`
 *   to locate `version.json` / `update.zip` even if a release is marked pre-release.
 * - Compares remote `buildNumber` with local `currentBuildNumber` and displays a single
 *   high-priority Android notification per new buildNumber.
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

    private static final Pattern GITHUB_REPO_PATTERN =
            Pattern.compile("github\\.com/([^/\\s]+/[^/\\s]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern SEMVER_PATTERN = Pattern.compile("(\\d+\\.\\d+\\.\\d+)");

    public UpdateCheckWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    public static String resolveBuildConfigRepo() {
        try {
            String repo = BuildConfig.GITHUB_REPO;
            if (repo != null) {
                String clean = repo.trim();
                if (!clean.isEmpty()
                        && clean.contains("/")
                        && !clean.contains("<")
                        && !clean.contains(">")) {
                    return clean;
                }
            }
        } catch (Throwable ignored) {
            // Fallback gracefully if BuildConfig field is unavailable
        }
        return "";
    }

    public static int resolveBuildConfigBuildNumber() {
        try {
            return Math.max(0, BuildConfig.APP_BUILD_NUMBER);
        } catch (Throwable ignored) {
            return 0;
        }
    }

    public static String resolveDefaultVersionUrl() {
        String repo = resolveBuildConfigRepo();
        if (!repo.isEmpty()) {
            return "https://github.com/" + repo + "/releases/latest/download/version.json";
        }
        return "";
    }

    private static String extractRepoFromUrl(String url) {
        if (url == null || url.trim().isEmpty()) return "";
        Matcher m = GITHUB_REPO_PATTERN.matcher(url);
        if (m.find()) {
            String found = m.group(1);
            if (found != null) {
                return found.replaceAll("\\.git$", "").trim();
            }
        }
        return "";
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        String versionUrl = prefs.getString(KEY_VERSION_URL, "");
        if (versionUrl == null || versionUrl.trim().isEmpty()) {
            versionUrl = resolveDefaultVersionUrl();
        }

        String repo = resolveBuildConfigRepo();
        if (repo.isEmpty()) {
            repo = extractRepoFromUrl(versionUrl);
        }
        if ((versionUrl == null || versionUrl.trim().isEmpty()) && !repo.isEmpty()) {
            versionUrl = "https://github.com/" + repo + "/releases/latest/download/version.json";
        }

        int currentBuild = prefs.getInt(KEY_CURRENT_BUILD, 0);
        int nativeBuild = resolveBuildConfigBuildNumber();
        if (nativeBuild > currentBuild) {
            currentBuild = nativeBuild;
        }
        int lastNotifiedBuild = prefs.getInt(KEY_LAST_NOTIFIED_BUILD, 0);

        if ((versionUrl == null || versionUrl.trim().isEmpty()) && repo.isEmpty()) {
            return Result.success();
        }

        try {
            JSONObject manifestJson = null;
            long ts = System.currentTimeMillis();

            // Stage 1A (Fastest Global CDN): jsDelivr ota-dist/version.json
            if (!repo.isEmpty()) {
                String cdnUrl = "https://cdn.jsdelivr.net/gh/" + repo + "@ota-dist/version.json?t=" + ts;
                String jsonRaw = fetchTextFollowingRedirects(cdnUrl, 5);
                if (jsonRaw != null && !jsonRaw.trim().isEmpty()) {
                    try {
                        manifestJson = new JSONObject(jsonRaw);
                    } catch (Throwable ignored) {
                        manifestJson = null;
                    }
                }
            }

            // Stage 1B (Fast Direct Mirror): GitHub Raw ota-dist/version.json
            if (manifestJson == null && !repo.isEmpty()) {
                String rawUrl = "https://raw.githubusercontent.com/" + repo + "/ota-dist/version.json?t=" + ts;
                String jsonRaw = fetchTextFollowingRedirects(rawUrl, 5);
                if (jsonRaw != null && !jsonRaw.trim().isEmpty()) {
                    try {
                        manifestJson = new JSONObject(jsonRaw);
                    } catch (Throwable ignored) {
                        manifestJson = null;
                    }
                }
            }

            // Stage 1C: Direct releases/latest/download/version.json
            if (manifestJson == null && versionUrl != null && !versionUrl.trim().isEmpty()) {
                String sep = versionUrl.contains("?") ? "&" : "?";
                String fetchUrl = versionUrl.trim() + sep + "t=" + ts;
                String jsonRaw = fetchTextFollowingRedirects(fetchUrl, 5);
                if (jsonRaw != null && !jsonRaw.trim().isEmpty()) {
                    try {
                        manifestJson = new JSONObject(jsonRaw);
                    } catch (Throwable ignored) {
                        manifestJson = null;
                    }
                }
            }

            // Stage 2 (404 / prerelease fallback): GitHub Releases list API (per_page=1)
            if (manifestJson == null && !repo.isEmpty()) {
                manifestJson = fetchManifestFromReleasesApi(repo);
            }

            if (manifestJson == null) {
                return Result.retry();
            }

            int remoteBuild = manifestJson.optInt("buildNumber", 0);
            String remoteVersion = manifestJson.optString("version", "").trim();
            String updateSizeText = manifestJson.optString("updateSizeText", "").trim();

            if (updateSizeText.isEmpty()) {
                long sizeBytes = manifestJson.optLong("updateSizeBytes", 0L);
                if (sizeBytes > 0L) {
                    updateSizeText = formatBytesArabic(sizeBytes);
                } else {
                    double sizeMb = manifestJson.optDouble("sizeMb", 0.0);
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
                String releaseTitle = manifestJson.optString("releaseTitle", "").trim();
                String releaseSummary = manifestJson.optString("releaseSummary", "").trim();
                JSONArray changesArr = manifestJson.optJSONArray("changes");
                showUpdateNotification(
                        context,
                        remoteVersion,
                        updateSizeText,
                        releaseTitle,
                        releaseSummary,
                        changesArr
                );
                prefs.edit().putInt(KEY_LAST_NOTIFIED_BUILD, remoteBuild).apply();
            }

            return Result.success();
        } catch (Throwable ignored) {
            return Result.retry();
        }
    }

    private JSONObject fetchManifestFromReleasesApi(String repo) {
        try {
            String apiUrl = "https://api.github.com/repos/" + repo + "/releases?per_page=1&t=" + System.currentTimeMillis();
            String rawList = fetchTextFollowingRedirects(apiUrl, 4);
            if (rawList == null || rawList.trim().isEmpty()) {
                return null;
            }
            JSONArray releases = new JSONArray(rawList);
            if (releases.length() == 0) {
                return null;
            }
            JSONObject release = null;
            for (int i = 0; i < releases.length(); i++) {
                JSONObject candidate = releases.optJSONObject(i);
                if (candidate != null && !candidate.optBoolean("draft", false)) {
                    release = candidate;
                    break;
                }
            }
            if (release == null) {
                release = releases.optJSONObject(0);
            }
            if (release == null) return null;

            JSONArray assets = release.optJSONArray("assets");
            String versionAssetUrl = null;
            long zipSizeBytes = 0L;

            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.optJSONObject(i);
                    if (asset == null) continue;
                    String name = asset.optString("name", "").toLowerCase(java.util.Locale.US);
                    if ("version.json".equals(name)) {
                        versionAssetUrl = asset.optString("browser_download_url", "");
                    } else if ("update.zip".equals(name)) {
                        zipSizeBytes = asset.optLong("size", 0L);
                    }
                }
            }

            if (versionAssetUrl != null && !versionAssetUrl.trim().isEmpty()) {
                String sep = versionAssetUrl.contains("?") ? "&" : "?";
                String assetJson = fetchTextFollowingRedirects(versionAssetUrl.trim() + sep + "t=" + System.currentTimeMillis(), 6);
                if (assetJson != null && !assetJson.trim().isEmpty()) {
                    return new JSONObject(assetJson);
                }
            }

            // Fallback: derive buildNumber and version from release body / tag_name
            String combined = release.optString("body", "") + " " + release.optString("tag_name", "");
            Matcher m = SEMVER_PATTERN.matcher(combined);
            if (m.find()) {
                String ver = m.group(1);
                if (ver != null) {
                    String[] parts = ver.split("\\.");
                    int derivedBuild = parts.length >= 3 ? Integer.parseInt(parts[2]) : 0;
                    JSONObject synthetic = new JSONObject();
                    synthetic.put("version", ver);
                    synthetic.put("buildNumber", derivedBuild);
                    if (zipSizeBytes > 0L) {
                        synthetic.put("updateSizeBytes", zipSizeBytes);
                        synthetic.put("updateSizeText", formatBytesArabic(zipSizeBytes));
                    }
                    return synthetic;
                }
            }
        } catch (Throwable ignored) {
            // Non-fatal fallback
        }
        return null;
    }

    /**
     * Robust HTTP GET that handles cross-domain and cross-protocol redirects
     * (e.g. github.com -> objects.githubusercontent.com / release-assets.githubusercontent.com)
     * across 301, 302, 303, 307, and 308 status codes.
     */
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
                conn.setRequestProperty("User-Agent", "TaibahNet-Android-Updater/2.1");
                conn.setRequestProperty("Accept", "application/vnd.github+json, application/json");
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
                    current = new URL(url, location.trim()).toString();
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

    private String mapChangeTypeArabic(String type) {
        if (type == null) return "تحسين";
        switch (type.trim().toLowerCase(java.util.Locale.US)) {
            case "add":
                return "إضافة";
            case "fix":
                return "إصلاح";
            case "security":
                return "أمان";
            case "remove":
                return "إزالة";
            case "improve":
            default:
                return "تحسين";
        }
    }

    private void showUpdateNotification(
            Context context,
            String version,
            String sizeText,
            String releaseTitle,
            String releaseSummary,
            JSONArray changesArr
    ) {
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
        String title = (releaseTitle != null && !releaseTitle.isEmpty())
                ? ("تحديث جديد: " + releaseTitle)
                : "تحديث جديد لتطبيق كروت طيبة نت";

        String collapsedBody = (releaseSummary != null && !releaseSummary.isEmpty())
                ? (releaseSummary + " (" + sizeText + ")")
                : ("الإصدار " + verLabel + " جاهز — حجم التحديث: " + sizeText + " فقط. اضغط للتحميل.");

        StringBuilder expanded = new StringBuilder();
        expanded.append("الإصدار ").append(verLabel).append(" • الحجم: ").append(sizeText);
        if (releaseSummary != null && !releaseSummary.isEmpty()) {
            expanded.append("\n").append(releaseSummary);
        }
        if (changesArr != null && changesArr.length() > 0) {
            int maxItems = Math.min(changesArr.length(), 4);
            for (int i = 0; i < maxItems; i++) {
                JSONObject item = changesArr.optJSONObject(i);
                if (item == null) continue;
                String itemText = item.optString("text", "").trim();
                if (itemText.isEmpty()) continue;
                String label = mapChangeTypeArabic(item.optString("type", "improve"));
                expanded.append("\n• ").append(label).append(": ").append(itemText);
            }
        }
        expanded.append("\nاضغط للتحديث الفوري دون فقدان بياناتك.");

        int smallIcon = context.getApplicationInfo().icon;
        if (smallIcon == 0) {
            smallIcon = android.R.drawable.stat_sys_download_done;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(smallIcon)
                .setContentTitle(title)
                .setContentText(collapsedBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(expanded.toString()))
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
