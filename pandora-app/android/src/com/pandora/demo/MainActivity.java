package com.pandora.demo;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

public final class MainActivity extends Activity {
    private WebView web;
    private static final String ORIGIN = "appassets.androidplatform.net";
    private static final Set<String> FILES = new HashSet<>(Arrays.asList("index.html", "favicon.svg", "src/app.js", "src/domain.js", "src/style.css", "src/mobile.css"));
    private static final Set<String> API_ORIGINS = new HashSet<>(Arrays.asList("localhost", "127.0.0.1", "10.0.2.2", "172.20.10.3"));
    // 模拟器通过 10.0.2.2 访问宿主机后端；真机调试时改为电脑局域网 IP
    private static final String API_BASE = "http://172.20.10.3:8080/api";

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(38, 79, 64));
        getWindow().setNavigationBarColor(Color.WHITE);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(247, 249, 246));
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " PandoraAndroid/0.3.0");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return false;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (isApi(req.getUrl())) return null;
                if (!isLocal(req.getUrl())) return response(403, "Forbidden", "text/plain", "External requests disabled");
                String path = req.getUrl().getPath();
                String file = path.equals("/") ? "index.html" : path.substring(1);
                if (!FILES.contains(file)) return response(404, "Not Found", "text/plain", "Not found");
                try {
                    String mime = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html";
                    Map<String, String> headers = new HashMap<>();
                    String csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:8080 http://127.0.0.1:8080 http://10.0.2.2:8080 http://172.20.10.3:8080; object-src 'none'; base-uri 'self'";
                    InputStream body;
                    if (file.equals("index.html")) {
                        // 在页面脚本执行前注入 API 基地址；nonce 保证 CSP 下仅这段内联脚本可执行
                        InputStream in = getAssets().open("web/" + file);
                        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                        byte[] chunk = new byte[4096];
                        int n;
                        while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n);
                        in.close();
                        String html = new String(buffer.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
                        String nonce = java.util.UUID.randomUUID().toString();
                        html = html.replace("<head>", "<head><script nonce=\"" + nonce + "\">window.__PANDORA_API_BASE__=\"" + API_BASE + "\";</script>");
                        csp = csp.replace("script-src 'self'", "script-src 'self' 'nonce-" + nonce + "'");
                        body = new ByteArrayInputStream(html.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    } else {
                        body = getAssets().open("web/" + file);
                    }
                    headers.put("Content-Security-Policy", csp);
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, body);
                } catch (Exception e) { return response(500, "Error", "text/plain", "Local resource unavailable"); }
            }
        });
        web.loadUrl("https://" + ORIGIN + "/index.html");
    }
    private boolean isLocal(Uri url) { return "https".equals(url.getScheme()) && ORIGIN.equals(url.getHost()); }
    private boolean isApi(Uri url) {
        String host = url.getHost();
        int port = url.getPort();
        return API_ORIGINS.contains(host) && (port == 8080 || port == -1);
    }
    private WebResourceResponse response(int status, String reason, String mime, String text) {
        return new WebResourceResponse(mime, "UTF-8", status, reason, new HashMap<>(), new ByteArrayInputStream(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("Boolean(window.pandoraBack && window.pandoraBack())", result -> {
            if (!"true".equals(result)) new AlertDialog.Builder(this).setTitle("退出潘多拉？").setMessage("确认关闭当前应用吗？")
                .setPositiveButton("退出", (dialog, which) -> finish()).setNegativeButton("继续使用", null).show();
        });
    }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
