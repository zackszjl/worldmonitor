const fs = require('fs');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
(async () => {
  const out = process.env.DIAG4_OUT;
  const base = process.env.DIAG4_BASE;
  if (!chromium) {
    fs.writeFileSync(out, JSON.stringify({ ok: false, reason: 'playwright-not-available' }, null, 2));
    return;
  }
  const logs=[]; const reqFailed=[]; let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext()).newPage();
    page.on('console', m => logs.push({ type: m.type(), text: m.text().slice(0,300) }));
    page.on('requestfailed', req => reqFailed.push({ url:req.url(), failure:req.failure()?.errorText || 'unknown' }));
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(30000);
    const state = await page.evaluate(() => {
      const panel = document.querySelector('[data-panel="insights"]');
      if (!panel) return { panelFound: false };
      const title = panel.querySelector('.panel-title')?.textContent?.trim() || '';
      const badge = panel.querySelector('.panel-data-badge')?.textContent?.trim() || '';
      const text = panel.querySelector('.panel-content')?.textContent?.trim() || '';
      const stories = panel.querySelectorAll('.insight-story').length;
      return { panelFound:true, title, badge, textHead:text.slice(0,260), stories };
    });
    const clusteringErrs = logs.filter(l => /\[App\] Clustering failed|Worker failed to become ready|Worker failed to initialize|Clustering failed/i.test(l.text));
    fs.writeFileSync(out, JSON.stringify({ ok:true, state, waitingDetected:/waiting for news data|等待/i.test(state.textHead||''), clusteringErrs, reqFailed:reqFailed.slice(0,40), logs:logs.slice(-120) }, null, 2));
  } catch (e) {
    fs.writeFileSync(out, JSON.stringify({ ok:false, error:String(e && e.message || e), reqFailed:reqFailed.slice(0,40), logs:logs.slice(-120) }, null, 2));
  } finally {
    if (browser) await browser.close();
  }
})();
