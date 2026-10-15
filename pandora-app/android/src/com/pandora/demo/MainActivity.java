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
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " PandoraAndroidDemo/0.2.0");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !isLocal(req.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (!isLocal(req.getUrl())) return response(403, "Forbidden", "text/plain", "External requests disabled");
                String path = req.getUrl().getPath();
                String file = path.equals("/") ? "index.html" : path.substring(1);
                if (!FILES.contains(file)) return response(404, "Not Found", "text/plain", "Not found");
                try {
                    InputStream body = getAssets().open("web/" + file);
                    String mime = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html";
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'");
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, body);
                } catch (Exception e) { return response(500, "Error", "text/plain", "Local resource unavailable"); }
            }
        });
        web.loadUrl("https://" + ORIGIN + "/index.html");
    }
    private boolean isLocal(Uri url) { return "https".equals(url.getScheme()) && ORIGIN.equals(url.getHost()); }
    private WebResourceResponse response(int status, String reason, String mime, String text) {
        return new WebResourceResponse(mime, "UTF-8", status, reason, new HashMap<>(), new ByteArrayInputStream(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("Boolean(window.pandoraBack && window.pandoraBack())", result -> {
            if (!"true".equals(result)) new AlertDialog.Builder(this).setTitle("退出演示？").setMessage("已保存的记录会保留在本机。")
                .setPositiveButton("退出", (dialog, which) -> finish()).setNegativeButton("继续使用", null).show();
        });
    }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
