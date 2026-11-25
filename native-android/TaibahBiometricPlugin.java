package net.taibah.wireless;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * TaibahBiometricPlugin
 *
 * Production-grade Native AndroidX BiometricPrompt plugin for TAIBAH NET (كروت طيبة نت).
 * - Supports Android 6.0 through Android 16 (API 23–35+)
 * - Unified Fingerprint + Face Unlock (including Samsung Face) + Device PIN/Pattern/Password
 * - Strict API 30+ vs API 23–29 PromptInfo configuration (NEVER calls setNegativeButtonText
 *   alongside DEVICE_CREDENTIAL / setDeviceCredentialAllowed, preventing IllegalArgumentException)
 * - AtomicBoolean re-entrancy guard + guaranteed single settlement on every branch/exception
 *   so the WebView UI can NEVER hang on "جاري التحقق...".
 */
@CapacitorPlugin(name = "TaibahBiometric")
public class TaibahBiometricPlugin extends Plugin {

    private final AtomicBoolean isAuthenticating = new AtomicBoolean(false);

    private static class AvailabilityResult {
        final boolean available;
        final boolean hasBiometric;
        final boolean hasDeviceCredential;
        final int statusCode;
        final String reason;

        AvailabilityResult(
                boolean available,
                boolean hasBiometric,
                boolean hasDeviceCredential,
                int statusCode,
                String reason
        ) {
            this.available = available;
            this.hasBiometric = hasBiometric;
            this.hasDeviceCredential = hasDeviceCredential;
            this.statusCode = statusCode;
            this.reason = reason;
        }
    }

    private AvailabilityResult inspectAvailability(Context context) {
        if (context == null) {
            return new AvailabilityResult(false, false, false, -1, "سياق التطبيق غير متاح حالياً.");
        }

        boolean hasDeviceCredential = false;
        try {
            KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) {
                hasDeviceCredential = km.isDeviceSecure();
            }
        } catch (Throwable ignored) {
            hasDeviceCredential = false;
        }

        BiometricManager biometricManager = BiometricManager.from(context);
        int bioOnlyStatus;
        int combinedStatus;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            bioOnlyStatus = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
            combinedStatus = biometricManager.canAuthenticate(
                    BiometricManager.Authenticators.BIOMETRIC_WEAK
                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            );
            boolean hasBiometric = (bioOnlyStatus == BiometricManager.BIOMETRIC_SUCCESS);
            boolean available = (combinedStatus == BiometricManager.BIOMETRIC_SUCCESS) || hasDeviceCredential;
            String reason = available ? "ready" : mapAvailabilityError(combinedStatus);
            return new AvailabilityResult(available, hasBiometric, hasDeviceCredential, combinedStatus, reason);
        } else {
            bioOnlyStatus = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
            boolean hasBiometric = (bioOnlyStatus == BiometricManager.BIOMETRIC_SUCCESS);
            boolean available = hasBiometric || hasDeviceCredential;
            int statusCode = available ? BiometricManager.BIOMETRIC_SUCCESS : bioOnlyStatus;
            String reason = available ? "ready" : mapAvailabilityError(bioOnlyStatus);
            return new AvailabilityResult(available, hasBiometric, hasDeviceCredential, statusCode, reason);
        }
    }

    private String mapAvailabilityError(int code) {
        switch (code) {
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "يرجى إعداد البصمة أو الوجه أو رمز قفل الشاشة في إعدادات أمان الهاتف أولاً.";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "لا يوجد مستشعر بصمة أو قفل شاشة مُعدّ على هذا الهاتف.";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "مستشعر الأمان مشغول حالياً — حاول بعد لحظة.";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
                return "يتطلب نظام أمان الهاتف تحديثاً لاستخدام التحقق الحيوي.";
            default:
                return "يرجى تفعيل البصمة أو الوجه أو رمز قفل الشاشة في إعدادات الهاتف أولاً.";
        }
    }

    @PluginMethod
    public void checkAvailability(PluginCall call) {
        try {
            AvailabilityResult res = inspectAvailability(getContext());
            JSObject out = new JSObject();
            out.put("available", res.available);
            out.put("hasBiometric", res.hasBiometric);
            out.put("hasDeviceCredential", res.hasDeviceCredential);
            out.put("statusCode", res.statusCode);
            out.put("reason", res.reason);
            call.resolve(out);
        } catch (Throwable t) {
            JSObject out = new JSObject();
            out.put("available", false);
            out.put("hasBiometric", false);
            out.put("hasDeviceCredential", false);
            out.put("statusCode", -1);
            out.put("reason", "تعذر فحص حالة أمان الهاتف: " + safeMessage(t));
            call.resolve(out);
        }
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        if (!isAuthenticating.compareAndSet(false, true)) {
            call.reject("نافذة التحقق الحيوي مفتوحة بالفعل — يرجى إتمامها أولاً.", "BUSY");
            return;
        }

        final AtomicBoolean settled = new AtomicBoolean(false);
        final Runnable releaseLock = () -> isAuthenticating.set(false);

        try {
            if (!(getActivity() instanceof FragmentActivity)) {
                if (settled.compareAndSet(false, true)) {
                    releaseLock.run();
                    call.reject("تعذر فتح نافذة التحقق الحيوي في هذه الشاشة.", "NO_FRAGMENT_ACTIVITY");
                }
                return;
            }

            final FragmentActivity activity = (FragmentActivity) getActivity();
            if (activity.isFinishing() || activity.isDestroyed()) {
                if (settled.compareAndSet(false, true)) {
                    releaseLock.run();
                    call.reject("شاشة التطبيق غير نشطة حالياً — حاول مجدداً.", "ACTIVITY_UNAVAILABLE");
                }
                return;
            }

            final AvailabilityResult availability = inspectAvailability(activity);
            if (!availability.available) {
                if (settled.compareAndSet(false, true)) {
                    releaseLock.run();
                    call.reject(availability.reason, "NOT_ENROLLED");
                }
                return;
            }

            final String title = nonEmptyOrDefault(call.getString("title"), "كروت طيبة نت — التحقق الحيوي");
            final String subtitle = call.getString("subtitle", "");
            final String description = call.getString("description", "");

            activity.runOnUiThread(() -> {
                try {
                    if (activity.isFinishing() || activity.isDestroyed()) {
                        if (settled.compareAndSet(false, true)) {
                            releaseLock.run();
                            call.reject("شاشة التطبيق غير نشطة حالياً.", "ACTIVITY_UNAVAILABLE");
                        }
                        return;
                    }

                    Executor executor = ContextCompat.getMainExecutor(activity);
                    BiometricPrompt biometricPrompt = new BiometricPrompt(
                            activity,
                            executor,
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                                    super.onAuthenticationSucceeded(result);
                                    if (settled.compareAndSet(false, true)) {
                                        releaseLock.run();
                                        JSObject ret = new JSObject();
                                        ret.put("verified", true);
                                        ret.put("authenticationType", result.getAuthenticationType());
                                        call.resolve(ret);
                                    }
                                }

                                @Override
                                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                                    super.onAuthenticationError(errorCode, errString);
                                    if (settled.compareAndSet(false, true)) {
                                        releaseLock.run();
                                        String code = mapPromptErrorCode(errorCode);
                                        String message = mapPromptErrorMessage(errorCode, errString);
                                        call.reject(message, code);
                                    }
                                }

                                @Override
                                public void onAuthenticationFailed() {
                                    super.onAuthenticationFailed();
                                    // Android BiometricPrompt lets the user retry until success or error/cancel.
                                }
                            }
                    );

                    BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                            .setTitle(title)
                            .setConfirmationRequired(false);

                    if (subtitle != null && !subtitle.trim().isEmpty()) {
                        builder.setSubtitle(subtitle.trim());
                    }
                    if (description != null && !description.trim().isEmpty()) {
                        builder.setDescription(description.trim());
                    }

                    // CRITICAL: Never call setNegativeButtonText() when DEVICE_CREDENTIAL or
                    // setDeviceCredentialAllowed(true) is enabled — doing so throws IllegalArgumentException!
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        builder.setAllowedAuthenticators(
                                BiometricManager.Authenticators.BIOMETRIC_WEAK
                                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                        );
                    } else {
                        //noinspection deprecation
                        builder.setDeviceCredentialAllowed(true);
                    }

                    BiometricPrompt.PromptInfo promptInfo = builder.build();
                    biometricPrompt.authenticate(promptInfo);
                } catch (Throwable uiErr) {
                    if (settled.compareAndSet(false, true)) {
                        releaseLock.run();
                        call.reject(
                                "تعذر تشغيل نافذة التحقق الحيوي على هذا الجهاز: " + safeMessage(uiErr),
                                "PROMPT_EXCEPTION"
                        );
                    }
                }
            });
        } catch (Throwable outerErr) {
            if (settled.compareAndSet(false, true)) {
                releaseLock.run();
                call.reject(
                        "حدث خطأ أثناء تهيئة التحقق الحيوي: " + safeMessage(outerErr),
                        "INIT_EXCEPTION"
                );
            }
        }
    }

    private String mapPromptErrorCode(int errorCode) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
                return "USER_CANCELED";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
                return "NOT_ENROLLED";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "LOCKOUT";
            case BiometricPrompt.ERROR_TIMEOUT:
                return "TIMEOUT";
            default:
                return "AUTH_ERROR_" + errorCode;
        }
    }

    private String mapPromptErrorMessage(int errorCode, CharSequence errString) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
                return "تم إلغاء نافذة التحقق الحيوي.";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
                return "يرجى إعداد البصمة أو الوجه أو رمز قفل الشاشة في إعدادات أمان الهاتف أولاً.";
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
                return "مستشعر البصمة أو الوجه غير متاح حالياً على هذا الهاتف.";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "تم قفل التحقق الحيوي مؤقتاً لكثرة المحاولات — استخدم رمز الجهاز أو كلمة المرور.";
            case BiometricPrompt.ERROR_TIMEOUT:
                return "انتهت مهلة التحقق الحيوي — حاول مرة أخرى.";
            default:
                String raw = errString != null ? errString.toString().trim() : "";
                return raw.isEmpty() ? "لم يكتمل التحقق الحيوي — حاول مجدداً." : raw;
        }
    }

    private String nonEmptyOrDefault(String value, String fallback) {
        if (value == null || value.trim().isEmpty()) {
            return fallback;
        }
        return value.trim();
    }

    private String safeMessage(Throwable t) {
        if (t == null || t.getMessage() == null || t.getMessage().trim().isEmpty()) {
            return "خطأ غير متوقع";
        }
        return t.getMessage().trim();
    }
}
