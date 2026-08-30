package org.knowledgeball.app;

import static org.junit.Assert.assertTrue;

import android.os.Environment;
import android.webkit.WebView;

import androidx.lifecycle.Lifecycle;
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
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario, "document.querySelector('#canvasHost canvas')?.width > 0 && window.__debug?.projection && window.__debug?.scene");
            assertTrue(evaluate(scenario,
                "(() => { const c=document.querySelector('#canvasHost canvas'); const gl=c?.getContext('webgl2')||c?.getContext('webgl'); return !!gl&&!gl.isContextLost()&&getComputedStyle(document.querySelector('#btnSettings')).display!=='none'; })()")
                .equals("true"));

            // Settings and the shared product locale must work inside the packaged WebView.
            assertTrue(evaluate(scenario, "document.querySelector('#btnSettings').click();document.querySelector('#settingsOverlay').classList.contains('show')").equals("true"));
            assertTrue(evaluate(scenario, "(() => {const s=document.querySelector('#setLocale');s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}));return document.documentElement.lang==='en'&&document.querySelector('#settingsOverlay').textContent.includes('Language');})()").equals("true"));
            device.pressBack();
            waitFor(scenario, "!document.querySelector('#settingsOverlay').classList.contains('show')");

            // Native Android must use the same AccountUiController surface as Web, not a legacy native auth panel.
            evaluate(scenario, "document.querySelector('#avatarBtn').click()");
            waitFor(scenario, "document.querySelector('#accountOverlay')?.classList.contains('show')");
            waitFor(scenario, "document.querySelector('#accountOverlay .modal-body')?.textContent?.includes('My energy')");
            assertTrue(evaluate(scenario, "document.querySelector('#accountOverlay .modal-body')?.textContent?.includes('Register / Sign in')").equals("true"));
            device.pressBack();
            waitFor(scenario, "!document.querySelector('#accountOverlay')?.classList.contains('show')");

            // Current -> Personal -> All -> Current must be the same product state machine as Web.
            assertTrue(evaluate(scenario, "document.querySelector('#btnPersonal')?.dataset.visibilityMode==='current'").equals("true"));
            evaluate(scenario, "document.querySelector('#btnPersonal').click()");
            waitFor(scenario, "document.querySelector('#btnPersonal')?.dataset.visibilityMode==='personal' && window.__debug?.interaction?.getVisibilityMode?.()==='personal'");
            evaluate(scenario, "document.querySelector('#btnPersonal').click()");
            waitFor(scenario, "document.querySelector('#btnPersonal')?.dataset.visibilityMode==='all' && window.__debug?.interaction?.getVisibilityMode?.()==='all'");
            evaluate(scenario, "document.querySelector('#btnPersonal').click()");
            waitFor(scenario, "document.querySelector('#btnPersonal')?.dataset.visibilityMode==='current' && window.__debug?.interaction?.getVisibilityMode?.()==='current'");

            // Search must open the current near-node detail implementation.
            assertTrue(evaluate(scenario,
                "(() => {const nodes=Object.values(window.__debug.projection.state.nodesById);const n=nodes.find(x=>x&&x.title);const input=document.querySelector('#aiInput');input.value=n.title;input.dispatchEvent(new Event('input',{bubbles:true}));return document.querySelectorAll('#aiResults [data-node-id]').length>0;})()")
                .equals("true"));
            assertTrue(evaluate(scenario, "document.querySelector('#aiResults [data-node-id]').click();document.querySelector('#nodeDetailOverlay')?.classList.contains('open')").equals("true"));

            // The mobile optimization action must be truly visible, in bounds and clickable.
            evaluate(scenario, "document.querySelector('#nodeDetailOverlay .node-detail-edit').click()");
            waitFor(scenario, "document.querySelector('#nodeDetailOverlay [data-node-detail-action=\"edit\"]')");
            assertTrue(evaluate(scenario,
                "(() => {const e=document.querySelector('#nodeDetailOverlay [data-node-detail-action=\"edit\"]');const s=getComputedStyle(e);const r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&s.pointerEvents!=='none'&&r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()")
                .equals("true"));
            evaluate(scenario, "document.querySelector('#nodeDetailOverlay [data-node-detail-action=\"edit\"]').click()");
            waitFor(scenario, "document.querySelector('#panel')?.classList.contains('open') && !document.querySelector('#nodeDetailOverlay')?.classList.contains('open')");
            device.pressBack();
            waitFor(scenario, "!document.querySelector('#panel')?.classList.contains('open') || document.querySelector('#panelTitle')");
            // If the first Back returns from the edit subview to detail host, a second Back must leave the host.
            if ("true".equals(evaluate(scenario, "document.querySelector('#panel')?.classList.contains('open')"))) {
                device.pressBack();
                waitFor(scenario, "!document.querySelector('#panel')?.classList.contains('open')");
            }

            // Current split create flow must surface validation feedback above its modal.
            assertTrue(evaluate(scenario, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true,bubbles:true}));document.querySelector('#knowledgeCreateOverlay')?.classList.contains('show')").equals("true"));
            evaluate(scenario, "document.querySelector('#knowledgeCreateOverlay [data-create-submit]').click()");
            waitFor(scenario, "!!document.querySelector('#knowledgeCreateOverlay [role=alert],#knowledgeCreateOverlay .form-error,#toast.show')");
            evaluate(scenario, "document.querySelector('#knowledgeCreateOverlay [data-create-close]').click()");
            waitFor(scenario, "!document.querySelector('#knowledgeCreateOverlay')?.classList.contains('show')");

            // Android lifecycle resume must preserve a live WebGL/product surface.
            scenario.moveToState(Lifecycle.State.CREATED);
            Thread.sleep(750);
            scenario.moveToState(Lifecycle.State.RESUMED);
            waitFor(scenario, "document.querySelector('#canvasHost canvas')?.width > 0 && !document.querySelector('#canvasHost canvas').getContext('webgl')?.isContextLost()");

            File pictureDir = InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES);
            assertTrue("Android external picture directory is unavailable", pictureDir != null && (pictureDir.exists() || pictureDir.mkdirs()));
            File screenshot = new File(pictureDir, "knowledge-ball-android.png");
            assertTrue("Unable to capture Android runtime evidence", device.takeScreenshot(screenshot));
            assertTrue("Android runtime screenshot is empty", screenshot.isFile() && screenshot.length() > 0);
        }
    }
}
