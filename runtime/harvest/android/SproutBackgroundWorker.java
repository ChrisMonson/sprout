package __PACKAGE__;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.webkit.WebViewAssetLoader;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

// Written by Sprout's harvest. Every so often (15 minutes at best; Android decides),
// loads the tool in a hidden web view so its periodic tasks run while the app is
// closed. boot.js runs the tasks, saves, and calls SproutNative.done().
public class SproutBackgroundWorker extends Worker {
    static final String WORK = "sprout-background";

    public static void schedule(Context context, boolean wanted) {
        WorkManager work = WorkManager.getInstance(context);
        if (!wanted) {
            work.cancelUniqueWork(WORK);
            return;
        }
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(SproutBackgroundWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(online)
            .build();
        work.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    public SproutBackgroundWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (inForeground()) return Result.success(); // the open app is doing the work
        Context context = getApplicationContext();
        CountDownLatch finished = new CountDownLatch(1);
        WebView[] holder = new WebView[1];
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            // Harvested apps are debug builds: let chrome://inspect see background runs too.
            if ((context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
            WebView web = new WebView(context);
            holder[0] = web;
            WebSettings settings = web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            // Same origin as the app (https://localhost), so it shares the tool's saved data.
            WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .setDomain("localhost")
                .addPathHandler("/", path -> publicAsset(context, path))
                .build();
            web.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return assets.shouldInterceptRequest(request.getUrl());
                }
            });
            web.addJavascriptInterface(new SproutBridge(context, web, finished::countDown), "SproutNative");
            web.loadUrl("https://localhost/index.html?sprout-background=1");
        });
        try {
            finished.await(2, TimeUnit.MINUTES);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        main.post(() -> { if (holder[0] != null) holder[0].destroy(); });
        return Result.success();
    }

    private static boolean inForeground() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
    }

    private static WebResourceResponse publicAsset(Context context, String path) {
        String file = path.isEmpty() ? "index.html" : path;
        try {
            InputStream in = context.getAssets().open("public/" + file);
            return new WebResourceResponse(mime(file), null, in);
        } catch (IOException missing) {
            return null;
        }
    }

    private static String mime(String file) {
        if (file.endsWith(".html")) return "text/html";
        if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript";
        if (file.endsWith(".css")) return "text/css";
        if (file.endsWith(".wasm")) return "application/wasm";
        if (file.endsWith(".json")) return "application/json";
        if (file.endsWith(".svg")) return "image/svg+xml";
        if (file.endsWith(".png")) return "image/png";
        if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
        if (file.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
