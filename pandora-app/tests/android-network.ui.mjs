import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the Android page origin, injected configuration and CSP against the
// running backend. API traffic is real; only bundled local assets are intercepted.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(path.join(root, 'android/src/com/pandora/demo/MainActivity.java'), 'utf8');
const api = JSON.parse(source.match(/String API_BASE = ("[^"\r\n]+");/)[1]);
const policyParts = source.match(/String csp = ("[^"\r\n]*") \+ apiOrigin\(\) \+ ("[^"\r\n]*");/);
assert.ok(policyParts, 'Android CSP must derive its API origin from API_BASE');
const policy = JSON.parse(policyParts[1]) + new URL(api).origin + JSON.parse(policyParts[2]);
const require = createRequire(import.meta.url);
const runtime = process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(runtime, 'playwright'));
const browser = await chromium.launch({channel:process.env.PANDORA_BROWSER_CHANNEL || 'msedge', headless:true,
  args:['--allow-running-insecure-content', '--disable-features=LocalNetworkAccessChecks']});
const artifacts = path.join(root, 'deliverables/verification');
await mkdir(artifacts, {recursive:true});
try {
  for (const broken of [true,false]) {
    const context = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
    const page = await context.newPage();
    const violations = [];
    await page.exposeFunction('recordViolation', directive => violations.push(directive));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.recordViolation(e.effectiveDirective)));
    const allowed = new Set(['index.html','favicon.svg','src/app.js','src/domain.js','src/style.css','src/mobile.css']);
    await context.route('https://appassets.androidplatform.net/**',async route => {
      const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if(!allowed.has(file)) return route.fulfill({status:404,body:'Not found'});
      let body = await readFile(path.join(root,file));
      const nonce = 'pandora-network-regression';
      let csp = broken ? policy.replace(new URL(api).origin, 'http://172.20.10.3:8080') : policy;
      if(file==='index.html') {
        body=Buffer.from(body.toString('utf8').replace('<head>',`<head><script nonce="${nonce}">window.__PANDORA_API_BASE__=${JSON.stringify(api)};</script>`));
        csp=csp.replace("script-src 'self'",`script-src 'self' 'nonce-${nonce}'`);
      }
      await route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html',headers:{'Content-Security-Policy':csp}});
    });
    await page.goto('https://appassets.androidplatform.net/index.html');
    await page.locator('[name=identifier]').fill(process.env.PANDORA_TEST_IDENTIFIER || '系统管理员');
    await page.locator('[name=password]').fill(process.env.PANDORA_TEST_PASSWORD || 'admin');
    await page.getByRole('button',{name:'登录',exact:true}).click();
    if(broken) {
      await page.locator('#toast').filter({hasText:'无法连接服务器'}).waitFor();
      assert.ok(violations.includes('connect-src'), 'Old address must reproduce the CSP failure');
    } else {
      await page.locator('.dashboard-page').waitFor();
      assert.deepEqual(violations,[]);
      await page.locator('[data-route=calendar]').click();
      await page.locator('.ios-calendar--month').waitFor();
      await page.locator('.calendar-day.is-today .day-date').click();
      await page.locator('[data-mode=day]').click();
      await page.locator('.calendar-day-timeline').waitFor();
      await page.screenshot({path:path.join(artifacts,'android-network-login.png'),fullPage:true});
    }
    await context.close();
  }
  console.log(JSON.stringify({passed:true,checks:['旧网络白名单重现登录请求被拦截','Android 页面来源和 CSP 下真实后端登录通过','工作区加载和日历事务视图通过'],api},null,2));
} finally {
  await browser.close();
}
