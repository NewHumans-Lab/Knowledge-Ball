package org.knowledgeball.app;

import static org.junit.Assert.assertTrue;

import android.webkit.WebView;

import androidx.lifecycle.Lifecycle;
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
    private static final String APP_PACKAGE = "org.knowledgeball.app";

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

    private void waitForPackage(UiDevice device, String expectedPackage, long timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (expectedPackage.equals(device.getCurrentPackageName())) return;
            Thread.sleep(200);
        }
        throw new AssertionError("Expected foreground package " + expectedPackage + ", got " + device.getCurrentPackageName());
    }

    @Test
    public void nativeAvatarButtonOpensSystemDocumentPicker() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.moveToState(Lifecycle.State.RESUMED);
            waitFor(scenario, "document.readyState==='complete' && !!window.Capacitor?.Plugins?.AvatarPicker");
            waitForPackage(device, APP_PACKAGE, 10_000);

            String result = evaluate(scenario,
                "(() => {" +
                "document.querySelector('#avatarPickerProbe')?.remove();" +
                "window.__kbAvatarPickerProbe='idle';" +
                "const button=document.createElement('button');" +
                "button.id='avatarPickerProbe';" +
                "button.textContent='修改头像';" +
                "button.style.cssText='position:fixed;left:24px;top:96px;z-index:2147483647;width:160px;height:56px';" +
                "button.addEventListener('click',()=>{" +
                "window.__kbAvatarPickerProbe='called';" +
                "window.Capacitor.Plugins.AvatarPicker.pickImage().then(r=>{window.__kbAvatarPickerProbe=r?.canceled?'canceled':'resolved';}).catch(()=>{window.__kbAvatarPickerProbe='rejected';});" +
                "});" +
                "document.body.append(button);" +
                "const r=button.getBoundingClientRect();" +
                "const x=Math.round(r.left+r.width/2);" +
                "const y=Math.round(r.top+r.height/2);" +
                "return {x,y,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,hit:document.elementFromPoint(x,y)?.id||''};" +
                "})()");

            JSONObject probe = new JSONObject(result);
            assertTrue("Native avatar probe must occupy its CSS hit-test point",
                "avatarPickerProbe".equals(probe.getString("hit")));

            int[] webViewOrigin = new int[2];
            int[] webViewSize = new int[2];
            scenario.onActivity(activity -> {
                WebView webView = activity.getBridge().getWebView();
                webView.getLocationOnScreen(webViewOrigin);
                webViewSize[0] = webView.getWidth();
                webViewSize[1] = webView.getHeight();
            });

            double scaleX = webViewSize[0] / probe.getDouble("viewportWidth");
            double scaleY = webViewSize[1] / probe.getDouble("viewportHeight");
            int tapX = webViewOrigin[0] + (int) Math.round(probe.getDouble("x") * scaleX);
            int tapY = webViewOrigin[1] + (int) Math.round(probe.getDouble("y") * scaleY);
            assertTrue("Unable to tap native avatar picker probe", device.click(tapX, tapY));

            long deadline = System.currentTimeMillis() + 10_000;
            boolean chooserOpened = false;
            boolean clickReachedJavaScript = false;
            while (System.currentTimeMillis() < deadline) {
                String currentPackage = device.getCurrentPackageName();
                if (currentPackage != null && !APP_PACKAGE.equals(currentPackage)) {
                    chooserOpened = true;
                    break;
                }
                if (!clickReachedJavaScript) {
                    clickReachedJavaScript = !"\"idle\"".equals(evaluate(scenario, "window.__kbAvatarPickerProbe"));
                }
                Thread.sleep(200);
            }
            assertTrue("Physical avatar tap did not reach the WebView button", clickReachedJavaScript || chooserOpened);
            assertTrue("Native AvatarPicker plugin did not open the Android document picker", chooserOpened);

            device.pressBack();
            waitForPackage(device, APP_PACKAGE, 10_000);
            waitFor(scenario, "window.__kbAvatarPickerProbe==='canceled'");
            evaluate(scenario, "document.querySelector('#avatarPickerProbe')?.remove();true");
        }
    }
}
