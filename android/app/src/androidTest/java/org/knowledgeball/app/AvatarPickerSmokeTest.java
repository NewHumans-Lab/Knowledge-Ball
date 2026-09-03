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
                "button.style.cssText='position:fixed;left:32px;top:160px;z-index:2147483647;width:280px;height:112px;touch-action:manipulation';" +
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

            // CSS pixels are square. Use the horizontal viewport ratio for both axes so
            // system/status-bar insets cannot distort the Y mapping through WebView height.
            double cssToScreenScale = webViewSize[0] / probe.getDouble("viewportWidth");
            int tapX = webViewOrigin[0] + (int) Math.round(probe.getDouble("x") * cssToScreenScale);
            int tapY = webViewOrigin[1] + (int) Math.round(probe.getDouble("y") * cssToScreenScale);
            assertTrue("Avatar probe tap X is outside the WebView: " + tapX,
                tapX >= webViewOrigin[0] && tapX < webViewOrigin[0] + webViewSize[0]);
            assertTrue("Avatar probe tap Y is outside the WebView: " + tapY,
                tapY >= webViewOrigin[1] && tapY < webViewOrigin[1] + webViewSize[1]);

            // JavaScript layout is synchronous, while the WebView compositor/touch hit-test
            // tree can lag a frame on a cold emulator. Let it settle before a real UiDevice tap.
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            device.waitForIdle();
            Thread.sleep(500);
            assertTrue("Native avatar probe lost its CSS hit-test point before physical tap",
                "\"avatarPickerProbe\"".equals(evaluate(scenario,
                    "document.elementFromPoint(" + probe.getDouble("x") + "," + probe.getDouble("y") + ")?.id||''")));

            boolean chooserOpened = false;
            boolean clickReachedJavaScript = false;
            for (int attempt = 0; attempt < 3 && !chooserOpened && !clickReachedJavaScript; attempt += 1) {
                assertTrue("Unable to tap native avatar picker probe at (" + tapX + ", " + tapY + ")",
                    device.click(tapX, tapY));

                long attemptDeadline = System.currentTimeMillis() + 2_500;
                while (System.currentTimeMillis() < attemptDeadline) {
                    String currentPackage = device.getCurrentPackageName();
                    if (currentPackage != null && !APP_PACKAGE.equals(currentPackage)) {
                        chooserOpened = true;
                        break;
                    }
                    clickReachedJavaScript = !"\"idle\"".equals(evaluate(scenario, "window.__kbAvatarPickerProbe"));
                    if (clickReachedJavaScript) break;
                    Thread.sleep(200);
                }

                if (!chooserOpened && !clickReachedJavaScript) {
                    InstrumentationRegistry.getInstrumentation().waitForIdleSync();
                    device.waitForIdle();
                    Thread.sleep(300);
                }
            }

            assertTrue("Physical avatar tap did not reach the WebView button at (" + tapX + ", " + tapY + ")",
                clickReachedJavaScript || chooserOpened);

            long chooserDeadline = System.currentTimeMillis() + 10_000;
            while (!chooserOpened && System.currentTimeMillis() < chooserDeadline) {
                String currentPackage = device.getCurrentPackageName();
                if (currentPackage != null && !APP_PACKAGE.equals(currentPackage)) {
                    chooserOpened = true;
                    break;
                }
                Thread.sleep(200);
            }
            assertTrue("Native AvatarPicker plugin did not open the Android document picker", chooserOpened);

            device.pressBack();
            waitForPackage(device, APP_PACKAGE, 10_000);
            waitFor(scenario, "window.__kbAvatarPickerProbe==='canceled'");
            evaluate(scenario, "document.querySelector('#avatarPickerProbe')?.remove();true");
        }
    }
}
