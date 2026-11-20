import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the Android page origin, injected configuration and CSP against the
// running backend. API traffic is real; only bundled local assets are intercepted.
const root = fileURLToPath(new URL('../', import.meta.url));
const api = process.env.PANDORA_TEST_API_BASE;
assert.ok(api && process.env.PANDORA_TEST_IDENTIFIER && process.env.PANDORA_TEST_PASSWORD, 'Run through PANDORA_E2E=true Maven tests, or provide an isolated backend and explicit test credentials');
import { serveAndroid } from './android-assets.mjs';
import { chromium, browserChannel } from '../../scripts/browser-test.mjs';
const browser = await chromium.launch({channel:browserChannel, headless:true,
  args:['--allow-running-insecure-content', '--disable-features=LocalNetworkAccessChecks']});
const artifacts = process.env.PANDORA_E2E_ARTIFACTS || path.join(root, 'deliverables/verification');
await mkdir(artifacts, {recursive:true});
try {
  for (const broken of [true,false]) {
    const context = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', e => window.cspViolations.push(e.effectiveDirective));
    });
    await serveAndroid(context, api, broken);
    await page.goto('https://appassets.androidplatform.net/index.html');
    await page.locator('[name=identifier]').fill(process.env.PANDORA_TEST_IDENTIFIER);
    await page.locator('[name=password]').fill(process.env.PANDORA_TEST_PASSWORD);
    await page.getByRole('button',{name:'登录',exact:true}).click();
    if(broken) {
      await page.locator('#toast').filter({hasText:'暂时无法连接服务'}).waitFor();
      await page.waitForFunction(() => window.cspViolations.includes('connect-src'));
    } else {
      await page.locator('.dashboard-page').waitFor();
      assert.deepEqual(await page.evaluate(() => window.cspViolations),[]);
      await page.locator('[data-route=calendar]').click();
      await page.locator('.ios-calendar--month').waitFor();
      await page.locator('.calendar-day.is-today .day-date').click();
      await page.locator('.calendar-mode-tabs [data-mode=week]').click();
      await page.locator('.calendar-day-timeline').waitFor();
      await page.screenshot({path:path.join(artifacts,'android-network-login.png'),fullPage:true});
    }
    await context.close();
  }
  console.log(JSON.stringify({passed:true,checks:['旧网络白名单重现登录请求被拦截','Android 页面来源和 CSP 下真实后端登录通过','工作区加载和日历事务视图通过'],api},null,2));
} finally {
  await browser.close();
}
