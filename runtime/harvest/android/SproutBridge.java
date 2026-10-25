package __PACKAGE__;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

// Written by Sprout's harvest. What the hidden background web view can't do
// itself: fetch from other sites (no CORS limits, like the open app) and post
// notifications. Exposed to boot.js as window.SproutNative.
public class SproutBridge {
    private final Context context;
    private final WebView web;
    private final Runnable onDone;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    // Not web.post(): the background web view is never attached to a window, and a
    // detached view holds posted work until it is.
    private final Handler main = new Handler(Looper.getMainLooper());

    SproutBridge(Context context, WebView web, Runnable onDone) {
        this.context = context;
        this.web = web;
        this.onDone = onDone;
    }

    @JavascriptInterface
    public void fetch(String id, String requestJson) {
        pool.execute(() -> {
            JSONObject reply = new JSONObject();
            try {
                JSONObject request = new JSONObject(requestJson);
                HttpURLConnection connection = (HttpURLConnection) new URL(request.getString("url")).openConnection();
                connection.setRequestMethod(request.optString("method", "GET"));
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                JSONObject headers = request.optJSONObject("headers");
                if (headers != null) {
                    for (Iterator<String> keys = headers.keys(); keys.hasNext(); ) {
                        String key = keys.next();
                        connection.setRequestProperty(key, headers.getString(key));
                    }
                }
                if (!request.isNull("body")) {
                    connection.setDoOutput(true);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(Base64.decode(request.getString("body"), Base64.DEFAULT));
                    }
                }
                int status = connection.getResponseCode();
                InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                if (in != null) {
                    byte[] buffer = new byte[16384];
                    for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
                    in.close();
                }
                JSONObject responseHeaders = new JSONObject();
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    if (header.getKey() != null) responseHeaders.put(header.getKey(), String.join(", ", header.getValue()));
                }
                reply.put("status", status);
                reply.put("headers", responseHeaders);
                reply.put("body", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            } catch (Exception e) {
                try { reply.put("error", e.toString()); } catch (Exception ignored) { }
            }
            String js = "window.__sproutNative && window.__sproutNative.done(" + JSONObject.quote(id) + "," + JSONObject.quote(reply.toString()) + ")";
            main.post(() -> web.evaluateJavascript(js, null));
        });
    }

    @JavascriptInterface
    public void notify(String key, String title, String body, double at) {
        SproutNotifyWorker.schedule(context, key, title, body, (long) at);
    }

    @JavascriptInterface
    public void cancel(String key) {
        SproutNotifyWorker.cancel(context, key);
    }

    @JavascriptInterface
    public void done() {
        pool.shutdown();
        if (onDone != null) onDone.run();
    }
}
