package org.knowledgeball.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

@CapacitorPlugin(name = "AndroidUpdate")
public class AndroidUpdatePlugin extends Plugin {
    private static final long MAX_APK_BYTES = 512L * 1024L * 1024L;
    private static final String UPDATE_DIR = "updates";

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String checksum = call.getString("checksum");
        String requestedName = call.getString("fileName");
        if (!isAllowedReleaseUrl(url)) {
            call.reject("Invalid Android release URL");
            return;
        }
        if (checksum == null || !checksum.matches("(?i)^sha256:[0-9a-f]{64}$")) {
            call.reject("Invalid Android release checksum");
            return;
        }
        String fileName = sanitizeFileName(requestedName);
        if (!fileName.endsWith(".apk")) {
            call.reject("Invalid Android installer filename");
            return;
        }

        new Thread(() -> {
            try {
                File target = downloadVerifiedApk(url, checksum.substring("sha256:".length()), fileName);
                getActivity().runOnUiThread(() -> requestPermissionOrInstall(call, target));
            } catch (Exception error) {
                getActivity().runOnUiThread(() -> call.reject("Android update download failed", error));
            }
        }, "knowledge-ball-update").start();
    }

    private File downloadVerifiedApk(String sourceUrl, String expectedSha256, String fileName) throws Exception {
        File directory = new File(getContext().getCacheDir(), UPDATE_DIR);
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Unable to create update cache");
        File target = new File(directory, fileName);
        File partial = new File(directory, fileName + ".part");
        if (partial.exists() && !partial.delete()) throw new IllegalStateException("Unable to reset partial update");

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setRequestProperty("User-Agent", "Knowledge-Ball-Android-Updater");
        connection.connect();
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("APK request failed (" + status + ")");
        }

        long total = 0;
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             FileOutputStream output = new FileOutputStream(partial, false)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_APK_BYTES) throw new IllegalStateException("APK exceeds size limit");
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
            }
            output.flush();
        } finally {
            connection.disconnect();
        }

        String actual = toHex(digest.digest());
        if (!actual.equalsIgnoreCase(expectedSha256)) {
            //noinspection ResultOfMethodCallIgnored
            partial.delete();
            throw new SecurityException("APK checksum mismatch");
        }
        if (target.exists() && !target.delete()) throw new IllegalStateException("Unable to replace cached installer");
        if (!partial.renameTo(target)) throw new IllegalStateException("Unable to finalize cached installer");
        return target;
    }

    private void requestPermissionOrInstall(PluginCall call, File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, settings, "handleInstallPermissionResult");
            return;
        }
        openInstaller(call, apk);
    }

    @ActivityCallback
    private void handleInstallPermissionResult(PluginCall call, ActivityResult ignored) {
        if (call == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("Android install permission was not granted");
            return;
        }
        String fileName = sanitizeFileName(call.getString("fileName"));
        File apk = new File(new File(getContext().getCacheDir(), UPDATE_DIR), fileName);
        if (!apk.isFile()) {
            call.reject("Downloaded Android installer is no longer available");
            return;
        }
        openInstaller(call, apk);
    }

    private void openInstaller(PluginCall call, File apk) {
        Uri contentUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apk
        );
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(contentUri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(install);
        JSObject result = new JSObject();
        result.put("status", "installer-opened");
        call.resolve(result);
    }

    private boolean isAllowedReleaseUrl(String value) {
        if (value == null) return false;
        try {
            URL url = new URL(value);
            return "https".equalsIgnoreCase(url.getProtocol())
                && "github.com".equalsIgnoreCase(url.getHost())
                && url.getPath().contains("/releases/download/");
        } catch (Exception ignored) {
            return false;
        }
    }

    private String sanitizeFileName(String value) {
        String name = value == null ? "knowledge-ball-update.apk" : value.trim();
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.isEmpty()) name = "knowledge-ball-update.apk";
        return name;
    }

    private String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return builder.toString();
    }
}
