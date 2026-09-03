package org.knowledgeball.app;

import static org.junit.Assert.assertTrue;

import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class AvatarPickerSmokeTest {
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        String[] value = new String[1];
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridge().getWebView();
            webView.evaluateJavascript(script, result -> {
                value[0] = result;
                latch.countDown();
            });
        });
        assertTrue("WebView JavaScript timed out", latch.await(20, TimeUnit.SECONDS));
        return value[0] == null ? "" : value[0];
    }

    private void waitFor(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate(scenario, "Boolean(" + expression + ")"))) return;
            Thread.sleep(250);
        }
        throw new AssertionError("Packaged WebView condition timed out: " + expression);
    }

    @Test
    public void directAvatarTapOpensNativeFileChooser() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario, "document.readyState==='complete' && !!document.querySelector('#avatarBtn')");

            String result = evaluate(scenario,
                "(() => {" +
                "document.querySelector('#avatarPickerProbe')?.remove();" +
                "const host=document.createElement('div');" +
                "host.id='avatarPickerProbe';" +
                "host.className='kb-auth-form kb-avatar-edit-row';" +
                "host.style.cssText='position:fixed;left:24px;top:96px;z-index:2147483647;width:220px;height:60px;background:#fff';" +
                "host.innerHTML='<div class=\"kb-profile-avatar kb-profile-avatar-preview\"></div><button class=\"btn ghost kb-avatar-upload-action\" type=\"button\">修改头像</button><input class=\"kb-avatar-file-input\" id=\"kbAvatarProbeFile\" type=\"file\" accept=\"image/*\" aria-label=\"选择头像图片\">';" +
                "document.body.append(host);" +
                "const input=host.querySelector('#kbAvatarProbeFile');" +
                "const r=input.getBoundingClientRect();" +
                "const x=Math.round(r.left+r.width/2);" +
                "const y=Math.round(r.top+r.height/2);" +
                "return {x,y,display:getComputedStyle(input).display,opacity:getComputedStyle(input).opacity,pointer:getComputedStyle(input).pointerEvents,hit:document.elementFromPoint(x,y)?.id||''};" +
                "})()");

            JSONObject probe = new JSONObject(result);
            assertTrue("Avatar file input must be rendered", "block".equals(probe.getString("display")));
            assertTrue("Avatar file input must remain pointer-active", !"none".equals(probe.getString("pointer")));
            assertTrue("Avatar file input must be the direct touch target", "kbAvatarProbeFile".equals(probe.getString("hit")));

            int[] webViewOrigin = new int[2];
            scenario.onActivity(activity -> activity.getBridge().getWebView().getLocationOnScreen(webViewOrigin));
            int tapX = webViewOrigin[0] + probe.getInt("x");
            int tapY = webViewOrigin[1] + probe.getInt("y");
            assertTrue("Unable to tap avatar picker probe", device.click(tapX, tapY));

            long deadline = System.currentTimeMillis() + 10_000;
            boolean chooserOpened = false;
            while (System.currentTimeMillis() < deadline) {
                String currentPackage = device.getCurrentPackageName();
                if (currentPackage != null && !"org.knowledgeball.app".equals(currentPackage)) {
                    chooserOpened = true;
                    break;
                }
                Thread.sleep(200);
            }
            assertTrue("Direct avatar tap did not open a native Android file chooser", chooserOpened);

            device.pressBack();
            long returnDeadline = System.currentTimeMillis() + 10_000;
            while (System.currentTimeMillis() < returnDeadline) {
                if ("org.knowledgeball.app".equals(device.getCurrentPackageName())) break;
                Thread.sleep(200);
            }
            assertTrue("Android app did not resume after closing the file chooser",
                "org.knowledgeball.app".equals(device.getCurrentPackageName()));

            evaluate(scenario, "document.querySelector('#avatarPickerProbe')?.remove();true");
        }
    }
}
