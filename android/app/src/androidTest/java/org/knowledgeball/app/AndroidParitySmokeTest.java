package org.knowledgeball.app;

import static org.junit.Assert.assertTrue;

import android.os.Environment;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class AndroidParitySmokeTest {
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        String[] value = new String[1];
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridge().getWebView();
            webView.evaluateJavascript(script, result -> { value[0] = result; latch.countDown(); });
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
    public void packagedWebAppSupportsCoreAndroidInteractions() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario, "document.querySelector('#canvasHost canvas')?.width > 0 && window.__debug?.projection");
            assertTrue(evaluate(scenario,
                "(() => { const c=document.querySelector('#canvasHost canvas'); const gl=c?.getContext('webgl2')||c?.getContext('webgl'); return !!gl&&!gl.isContextLost()&&getComputedStyle(document.querySelector('#btnSettings')).display!=='none'; })()")
                .equals("true"));

            assertTrue(evaluate(scenario, "document.querySelector('#btnSettings').click();document.querySelector('#settingsOverlay').classList.contains('show')").equals("true"));
            assertTrue(evaluate(scenario, "(() => {const s=document.querySelector('#setLocale');s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}));return document.documentElement.lang==='en'&&document.querySelector('#settingsOverlay').textContent.includes('Language');})() ").equals("true"));

            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            waitFor(scenario, "!document.querySelector('#settingsOverlay').classList.contains('show')");

            assertTrue(evaluate(scenario,
                "(() => {const nodes=Object.values(window.__debug.projection.state.nodesById);const input=document.querySelector('#aiInput');input.value=nodes[0].title;input.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelectorAll('#aiResults [data-node-id]').length>0;})()")
                .equals("true"));
            assertTrue(evaluate(scenario, "document.querySelector('#aiResults [data-node-id]').click();document.querySelector('#nodeDetailOverlay')?.classList.contains('open')").equals("true"));
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
            waitFor(scenario, "!document.querySelector('#nodeDetailOverlay')?.classList.contains('open')");

            assertTrue(evaluate(scenario, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true,bubbles:true}));document.querySelector('#knowledgeCreateOverlay')?.classList.contains('show')").equals("true"));
            assertTrue(evaluate(scenario, "document.querySelector('#knowledgeCreateOverlay [data-create-submit]').click();!!document.querySelector('#knowledgeCreateOverlay [role=alert],#knowledgeCreateOverlay .form-error,#toast.show')").equals("true"));
            evaluate(scenario, "document.querySelector('#knowledgeCreateOverlay [data-create-close]').click()");

            File screenshot = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "knowledge-ball-android.png");
            assertTrue("Unable to capture Android runtime evidence", UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(screenshot));
        }
    }
}
