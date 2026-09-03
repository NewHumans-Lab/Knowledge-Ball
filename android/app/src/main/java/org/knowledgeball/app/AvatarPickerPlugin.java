package org.knowledgeball.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

@CapacitorPlugin(name = "AvatarPicker")
public class AvatarPickerPlugin extends Plugin {
    private static final long MAX_INPUT_BYTES = 20L * 1024L * 1024L;
    private static final String CACHE_FILE_NAME = "knowledge-ball-avatar-source";

    @PluginMethod
    public void pickImage(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        startActivityForResult(call, intent, "handlePickImageResult");
    }

    @ActivityCallback
    private void handlePickImageResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        Uri source = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || source == null) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        String mimeType = resolver.getType(source);
        if (mimeType == null || !mimeType.startsWith("image/")) {
            call.reject("请选择图片文件");
            return;
        }

        File target = new File(getContext().getCacheDir(), CACHE_FILE_NAME);
        try {
            copyWithLimit(resolver, source, target);
            JSObject response = new JSObject();
            response.put("canceled", false);
            response.put("uri", Uri.fromFile(target).toString());
            response.put("mimeType", mimeType);
            response.put("name", displayName(resolver, source));
            call.resolve(response);
        } catch (AvatarTooLargeException error) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            call.reject("头像原图不能超过 20 MB");
        } catch (IOException error) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            call.reject("无法读取所选头像");
        }
    }

    private void copyWithLimit(ContentResolver resolver, Uri source, File target) throws IOException, AvatarTooLargeException {
        try (InputStream input = resolver.openInputStream(source)) {
            if (input == null) throw new IOException("image stream unavailable");
            try (FileOutputStream output = new FileOutputStream(target, false)) {
                byte[] buffer = new byte[16 * 1024];
                long total = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_INPUT_BYTES) throw new AvatarTooLargeException();
                    output.write(buffer, 0, read);
                }
                output.flush();
            }
        }
    }

    private String displayName(ContentResolver resolver, Uri source) {
        try (Cursor cursor = resolver.query(source, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String value = cursor.getString(index);
                    if (value != null && !value.trim().isEmpty()) return value;
                }
            }
        } catch (RuntimeException ignored) {
            // The display name is optional; the copied cache file remains authoritative.
        }
        return "avatar";
    }

    private static final class AvatarTooLargeException extends Exception {}
}
