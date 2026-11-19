import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function serveAndroid(context, api, broken = false) {
  const source = await readFile(path.join(root, 'android/src/com/pandora/demo/MainActivity.java'), 'utf8');
  assert.match(source, /String API_BASE = BuildConfig.API_BASE/);
  const parts = source.match(/String csp = ("[^"\r\n]*") \+ apiOrigin\(\) \+ ("[^"\r\n]*");/);
  assert.ok(parts, 'Android CSP must derive its API origin from the build configuration');
  const policy = JSON.parse(parts[1]) + (broken ? 'https://blocked.invalid' : new URL(api).origin) + JSON.parse(parts[2]);
  const allowed = new Set(['index.html','favicon.svg','src/app.js','src/domain.js', 'src/date-picker.js','src/style.css','src/mobile.css']);
  // Only APK assets are intercepted. Every API request reaches the actual backend.
  await context.route('https://appassets.androidplatform.net/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (!allowed.has(file)) return route.fulfill({ status:404, body:'Not found' });
    let body = await readFile(path.join(root, file));
    const nonce = 'pandora-network-regression';
    let csp = policy;
    if (file === 'index.html') {
      body = Buffer.from(body.toString('utf8').replace('<head>', `<head><script nonce="${nonce}">window.__PANDORA_API_BASE__=${JSON.stringify(api)};</script>`));
      csp = csp.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
    }
    await route.fulfill({ body, contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html', headers:{'Content-Security-Policy':csp} });
  });
}
