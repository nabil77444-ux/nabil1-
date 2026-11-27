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
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * UpdateCheckWorker
 *
 * Periodic background Android WorkManager worker for TAIBAH NET (كروت طيبة نت).
 * - Runs every 2 hours (when NetworkType.CONNECTED) even while the app is closed.
 * - Uses BuildConfig.GITHUB_REPO (auto-injected by GitHub Actions / Gradle) with SharedPreferences override.
 * - Queries ALL 3 remote sources in parallel (8s timeout per source, unique `?t=<NOW>`, `Cache-Control: no-cache`):
 *     1) GitHub Releases Direct: `https://github.com/<REPO>/releases/latest/download/version.json?t=<NOW>`
 *     2) GitHub Raw (`ota-dist`): `https://raw.githubusercontent.com/<REPO>/ota-dist/version.json?t=<NOW>`
 *     3) jsDelivr CDN Mirror: `https://cdn.jsdelivr.net/gh/<REPO>@ota-dist/version.json?t=<NOW>`
 *   Falls back to GitHub Releases API only if all 3 fail.
 * - NEVER stops at the first responder; collects all valid JSON manifests and selects the single
 *   highest release by `buildNumber` -> `versionCode` -> numeric semantic `version` parts.
 * - Compares remote release vs local installed release using `isNewerRelease` and displays a single
 *   high-priority Android notification per new release.
 */
public class UpdateCheckWorker extends Worker {

    public static final String PREFS_NAME = "taibah_ota_prefs";
    public static final String KEY_CURRENT_BUILD = "currentBuildNumber";
    public static final String KEY_VERSION_URL = "versionJsonUrl";
    public static final String KEY_LAST_NOTIFIED_BUILD = "lastNotifiedBuild";
    public static final String KEY_LAST_NOTIFIED_VERSION = "lastNotifiedVersion";
    public static final String KEY_PENDING_OPEN_DIALOG = "pendingOpenUpdateDialog";

    public static final String CHANNEL_ID = "taibah_updates_channel";
    public static final int NOTIFICATION_ID = 772466;
    public static final String EXTRA_OPEN_UPDATE_DIALOG = "OPEN_UPDATE_DIALOG";

    private static final int SOURCE_TIMEOUT_MS = 8000;

    private static final Pattern GITHUB_REPO_PATTERN =
            Pattern.compile("github\\.com/([^/\\s]+/[^/\\s]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern SEMVER_PATTERN = Pattern.compile("(\\d+\\.\\d+\\.\\d+)");

    private static final class ManifestCandidate {
        final JSONObject json;
        final int buildNumber;
        final int versionCode;
        final String version;
        final int sourcePriority;

        ManifestCandidate(JSONObject json, int sourcePriority) {
            this.json = json;
            this.version = json.optString("version", "").trim();
            int rawBuild = json.optInt("buildNumber", 0);
            int rawCode = json.optInt("versionCode", 0);
            int derivedBuild = extractPatchBuild(this.version);
            if (rawBuild > 0) {
                this.buildNumber = rawBuild;
            } else if (rawCode > 1000) {
                this.buildNumber = rawCode - 1000;
            } else {
                this.buildNumber = derivedBuild;
            }
            this.versionCode = rawCode > 0 ? rawCode : (this.buildNumber > 0 ? 1000 + this.buildNumber : 0);
            this.sourcePriority = sourcePriority;
        }
    }

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

    private static int[] parseVersionParts(String ver) {
        if (ver == null || ver.trim().isEmpty()) {
            return new int[] { 0, 0, 0 };
        }
        String cleaned = ver.trim().replaceFirst("^[vV]", "");
        String[] tokens = cleaned.split("[^0-9]+");
        List<Integer> nums = new ArrayList<>();
        for (String t : tokens) {
            if (t == null || t.isEmpty()) continue;
            try {
                nums.add(Integer.parseInt(t));
            } catch (NumberFormatException ignored) {
                nums.add(0);
            }
        }
        int len = Math.max(nums.size(), 3);
        int[] out = new int[len];
        for (int i = 0; i < nums.size(); i++) {
            out[i] = nums.get(i);
        }
        return out;
    }

    private static int extractPatchBuild(String ver) {
        int[] parts = parseVersionParts(ver);
        return parts.length >= 3 ? Math.max(0, parts[2]) : 0;
    }

    private static int compareSemver(String a, String b) {
        int[] pa = parseVersionParts(a);
        int[] pb = parseVersionParts(b);
        int maxLen = Math.max(pa.length, pb.length);
        for (int i = 0; i < maxLen; i++) {
            int va = i < pa.length ? pa[i] : 0;
            int vb = i < pb.length ? pb[i] : 0;
            if (va != vb) return Integer.compare(va, vb);
        }
        return 0;
    }

    private static int compareCandidates(ManifestCandidate a, ManifestCandidate b) {
        if (a.buildNumber != b.buildNumber) {
            return Integer.compare(a.buildNumber, b.buildNumber);
        }
        if (a.versionCode != b.versionCode) {
            return Integer.compare(a.versionCode, b.versionCode);
        }
        int semverCmp = compareSemver(a.version, b.version);
        if (semverCmp != 0) {
            return semverCmp;
        }
        return Integer.compare(a.sourcePriority, b.sourcePriority);
    }

    private static boolean isNewerRelease(
            int remoteBuild,
            int remoteVersionCode,
            String remoteVersion,
            int currentBuild,
            int currentVersionCode,
            String currentVersion
    ) {
        if (remoteBuild > 0 && currentBuild > 0 && remoteBuild > currentBuild) {
            return true;
        }
        if (remoteVersionCode > 0 && currentVersionCode > 0 && remoteVersionCode > currentVersionCode) {
            return true;
        }
        return remoteVersion != null && !remoteVersion.isEmpty()
                && compareSemver(remoteVersion, currentVersion) > 0;
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
        int currentVersionCode = currentBuild > 0 ? (1000 + currentBuild) : 0;
        String currentVersion = currentBuild > 0 ? ("2.1." + currentBuild) : "2.1.0";
        try {
            android.content.pm.PackageInfo pInfo =
                    context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (pInfo != null) {
                if (pInfo.versionCode > currentVersionCode) {
                    currentVersionCode = pInfo.versionCode;
                }
                if (pInfo.versionName != null && !pInfo.versionName.trim().isEmpty()
                        && compareSemver(pInfo.versionName.trim(), currentVersion) > 0) {
                    currentVersion = pInfo.versionName.trim();
                }
            }
        } catch (Throwable ignored) {
            // Keep BuildConfig / prefs baseline
        }

        int lastNotifiedBuild = prefs.getInt(KEY_LAST_NOTIFIED_BUILD, 0);
        String lastNotifiedVersion = prefs.getString(KEY_LAST_NOTIFIED_VERSION, "");

        if ((versionUrl == null || versionUrl.trim().isEmpty()) && repo.isEmpty()) {
            return Result.success();
        }

        ExecutorService pool = Executors.newFixedThreadPool(3);
        try {
            final long ts = System.currentTimeMillis();
            List<Callable<ManifestCandidate>> tasks = new ArrayList<>();

            // 1. GitHub Releases Direct (highest freshness priority)
            final String releasesDirectUrl;
            if (!repo.isEmpty()) {
                releasesDirectUrl = "https://github.com/" + repo + "/releases/latest/download/version.json?t=" + ts;
            } else {
                String sep = versionUrl.contains("?") ? "&" : "?";
                releasesDirectUrl = versionUrl.trim() + sep + "t=" + ts;
            }
            tasks.add(() -> fetchCandidate(releasesDirectUrl, 3));

            // 2. GitHub Raw (ota-dist branch)
            if (!repo.isEmpty()) {
                final String rawUrl = "https://raw.githubusercontent.com/" + repo + "/ota-dist/version.json?t=" + ts;
                tasks.add(() -> fetchCandidate(rawUrl, 2));

                // 3. jsDelivr Mirror (ota-dist branch)
                final String cdnUrl = "https://cdn.jsdelivr.net/gh/" + repo + "@ota-dist/version.json?t=" + ts;
                tasks.add(() -> fetchCandidate(cdnUrl, 1));
            }

            List<ManifestCandidate> candidates = new ArrayList<>();
            List<Future<ManifestCandidate>> futures = pool.invokeAll(tasks, 10, TimeUnit.SECONDS);
            for (Future<ManifestCandidate> f : futures) {
                try {
                    if (!f.isCancelled()) {
                        ManifestCandidate c = f.get(1, TimeUnit.SECONDS);
                        if (c != null) {
                            candidates.add(c);
                        }
                    }
                } catch (Throwable ignored) {
                    // Single source failed or timed out — keep collecting others
                }
            }

            // Fallback: GitHub Releases list API only if all direct sources failed
            if (candidates.isEmpty() && !repo.isEmpty()) {
                JSONObject apiManifest = fetchManifestFromReleasesApi(repo);
                if (apiManifest != null) {
                    candidates.add(new ManifestCandidate(apiManifest, 2));
                }
            }

            if (candidates.isEmpty()) {
                return Result.retry();
            }

            // Pick the SINGLE highest release across ALL responded sources
            ManifestCandidate best = candidates.get(0);
            for (int i = 1; i < candidates.size(); i++) {
                ManifestCandidate cand = candidates.get(i);
                if (compareCandidates(cand, best) > 0) {
                    best = cand;
                }
            }

            JSONObject manifestJson = best.json;
            int remoteBuild = best.buildNumber;
            int remoteVersionCode = best.versionCode;
            String remoteVersion = best.version;
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

            boolean isNewerThanInstalled = isNewerRelease(
                    remoteBuild,
                    remoteVersionCode,
                    remoteVersion,
                    currentBuild,
                    currentVersionCode,
                    currentVersion
            );
            boolean alreadyNotified =
                    (remoteBuild > 0 && remoteBuild <= lastNotifiedBuild)
                            && (lastNotifiedVersion != null
                            && !lastNotifiedVersion.isEmpty()
                            && compareSemver(remoteVersion, lastNotifiedVersion) <= 0);

            if (isNewerThanInstalled && !alreadyNotified) {
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
                prefs.edit()
                        .putInt(KEY_LAST_NOTIFIED_BUILD, Math.max(remoteBuild, lastNotifiedBuild))
                        .putString(KEY_LAST_NOTIFIED_VERSION, remoteVersion)
                        .apply();
            }

            return Result.success();
        } catch (Throwable ignored) {
            return Result.retry();
        } finally {
            pool.shutdownNow();
        }
    }

    private ManifestCandidate fetchCandidate(String url, int sourcePriority) {
        try {
            String jsonRaw = fetchTextFollowingRedirects(url, 5);
            if (jsonRaw != null && !jsonRaw.trim().isEmpty()) {
                JSONObject obj = new JSONObject(jsonRaw);
                if (!obj.optString("version", "").trim().isEmpty()) {
                    return new ManifestCandidate(obj, sourcePriority);
                }
            }
        } catch (Throwable ignored) {
            // Non-fatal single-source failure
        }
        return null;
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
                conn.setConnectTimeout(SOURCE_TIMEOUT_MS);
                conn.setReadTimeout(SOURCE_TIMEOUT_MS);
                conn.setUseCaches(false);
                conn.setRequestProperty("User-Agent", "TaibahNet-Android-Updater/2.1");
                conn.setRequestProperty("Accept", "application/vnd.github+json, application/json");
                conn.setRequestProperty("Cache-Control", "no-cache, no-store, max-age=0");
                conn.setRequestProperty("Pragma", "no-cache");

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

    private String stripDuplicateCategoryPrefix(String rawText) {
        if (rawText == null) return "";
        String cleaned = rawText.trim();
        String[] prefixes = new String[] {
                "إضافة:", "اضافة:", "إضافة :", "اضافة :",
                "تحسين:", "تحسين :",
                "إصلاح:", "اصلاح:", "إصلاح :", "اصلاح :",
                "أمان:", "امان:", "أمان :", "امان :",
                "إزالة:", "ازالة:", "إزالة :", "ازالة :"
        };
        boolean changed = true;
        while (changed) {
            changed = false;
            for (String p : prefixes) {
                if (cleaned.startsWith(p)) {
                    cleaned = cleaned.substring(p.length()).trim();
                    changed = true;
                }
            }
        }
        return cleaned;
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
                String itemText = stripDuplicateCategoryPrefix(item.optString("text", ""));
                if (itemText.isEmpty()) continue;
                expanded.append("\n• ").append(itemText);
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
