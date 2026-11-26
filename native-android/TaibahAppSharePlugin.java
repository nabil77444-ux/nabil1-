package net.taibah.wireless;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * TaibahAppSharePlugin
 *
 * Production Capacitor 7 Android plugin for TAIBAH NET:
 * Shares the currently installed APK (`applicationInfo.sourceDir`) directly as
 * `TaibahNet-Cards.apk` via Android FileProvider + Intent.ACTION_SEND so users
 * can send the actual installable app file through WhatsApp, Bluetooth, Nearby Share,
 * Telegram, etc., with zero UI thread blocking.
 */
@CapacitorPlugin(name = "TaibahAppShare")
public class TaibahAppSharePlugin extends Plugin {

    private static final String SHARED_DIR_NAME = "shared_apk";
    private static final String SHARED_APK_NAME = "TaibahNet-Cards.apk";
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final int COPY_BUFFER_BYTES = 64 * 1024;

    private final ExecutorService shareExecutor = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        try {
            shareExecutor.shutdownNow();
        } catch (Throwable ignored) {
            // Non-fatal
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void shareInstalledApk(PluginCall call) {
        final Context ctx = getContext();
        final Activity activity = getActivity();
        if (ctx == null || activity == null) {
            call.reject("تعذر الوصول إلى سياق التطبيق لمشاركة ملف APK.");
            return;
        }

        final String customSubject = call.getString("subject", "تطبيق كروت طيبة نت — TAIBAH NET");
        final String customText = call.getString(
                "text",
                "تطبيق كروت طيبة نت — شبكة طيبة نت اللاسلكية (TAIBAH NET)"
        );
        final String chooserTitle = call.getString("chooserTitle", "مشاركة تطبيق كروت طيبة نت");

        shareExecutor.execute(() -> {
            try {
                String sourceDirPath = ctx.getApplicationInfo().sourceDir;
                if (sourceDirPath == null || sourceDirPath.trim().isEmpty()) {
                    call.reject("تعذر تحديد مسار ملف التطبيق المثبّت.");
                    return;
                }

                File sourceApk = new File(sourceDirPath);
                if (!sourceApk.isFile() || !sourceApk.canRead() || sourceApk.length() <= 0L) {
                    call.reject("ملف التطبيق المثبّت غير متاح للقراءة حالياً.");
                    return;
                }

                File shareDir = new File(ctx.getCacheDir(), SHARED_DIR_NAME);
                if (!shareDir.exists() && !shareDir.mkdirs()) {
                    call.reject("تعذر إنشاء مجلد التخزين المؤقت لمشاركة التطبيق.");
                    return;
                }

                File outFile = new File(shareDir, SHARED_APK_NAME);
                long sourceSize = sourceApk.length();
                long sourceLastMod = sourceApk.lastModified();

                // Skip copying immediately if cached APK matches current installed binary
                boolean cacheIsFresh = outFile.isFile()
                        && outFile.length() == sourceSize
                        && outFile.lastModified() >= sourceLastMod;

                if (!cacheIsFresh) {
                    File tmpFile = new File(shareDir, SHARED_APK_NAME + ".tmp");
                    if (tmpFile.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        tmpFile.delete();
                    }

                    copyFileBuffered(sourceApk, tmpFile);

                    if (outFile.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        outFile.delete();
                    }
                    if (!tmpFile.renameTo(outFile)) {
                        // Fallback direct copy if atomic rename fails across mounts
                        copyFileBuffered(tmpFile, outFile);
                        //noinspection ResultOfMethodCallIgnored
                        tmpFile.delete();
                    }
                    //noinspection ResultOfMethodCallIgnored
                    outFile.setLastModified(sourceLastMod > 0L ? sourceLastMod : System.currentTimeMillis());
                }

                String authority = ctx.getPackageName() + ".fileprovider";
                Uri apkUri = FileProvider.getUriForFile(ctx, authority, outFile);

                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType(APK_MIME_TYPE);
                sendIntent.putExtra(Intent.EXTRA_STREAM, apkUri);
                sendIntent.putExtra(Intent.EXTRA_SUBJECT, customSubject);
                sendIntent.putExtra(Intent.EXTRA_TEXT, customText);
                sendIntent.setClipData(ClipData.newRawUri(SHARED_APK_NAME, apkUri));
                sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(sendIntent, chooserTitle);
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                final long finalSize = outFile.length();
                activity.runOnUiThread(() -> {
                    try {
                        activity.startActivity(chooser);
                        JSObject out = new JSObject();
                        out.put("shared", true);
                        out.put("fileName", SHARED_APK_NAME);
                        out.put("sizeBytes", finalSize);
                        call.resolve(out);
                    } catch (Throwable uiErr) {
                        call.reject("تعذر فتح نافذة مشاركة ملف التطبيق: " + uiErr.getMessage());
                    }
                });
            } catch (Throwable t) {
                call.reject("تعذر تجهيز ملف التطبيق للمشاركة: " + (t.getMessage() != null ? t.getMessage() : "خطأ غير متوقع"));
            }
        });
    }

    private static void copyFileBuffered(File src, File dst) throws IOException {
        byte[] buffer = new byte[COPY_BUFFER_BYTES];
        try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(src), COPY_BUFFER_BYTES);
             BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(dst), COPY_BUFFER_BYTES)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                if (read > 0) {
                    out.write(buffer, 0, read);
                }
            }
            out.flush();
        }
    }
}
