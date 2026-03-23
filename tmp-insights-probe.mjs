import fs from 'node:fs';
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:3000/';
const waitMs = Number(process.argv[3] || 30000);

const consoleEvents = [];
const pageErrors = [];
const failedRequests = [];

const browser = await chromium.launch({
  headless: true,
  channel: 'msedge',
});

const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

page.on('console', (msg) => {
  const type = msg.type();
  const text = msg.text();
  consoleEvents.push({ type, text, location: msg.location() });
});

page.on('pageerror', (error) => {
  pageErrors.push(String(error?.stack || error?.message || error));
});

page.on('requestfailed', (request) => {
  failedRequests.push({
    url: request.url(),
    method: request.method(),
    errorText: request.failure()?.errorText || 'unknown',
  });
});

let gotoError = null;
try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (err) {
  gotoError = String(err?.stack || err?.message || err);
}

if (!gotoError) {
  await page.waitForTimeout(waitMs);
}

const panelState = await page.evaluate(() => {
  const panel = document.querySelector('[data-panel="insights"]');
  const badge = panel?.querySelector('.panel-data-badge');
  const empty = panel?.querySelector('.insights-empty');
  const stories = panel?.querySelectorAll('.insight-story') || [];
  const statusText = panel?.querySelector('.insights-status-text');
  const disabled = panel?.querySelector('.insights-disabled');

  const text = (panel?.textContent || '').replace(/\s+/g, ' ').trim();

  return {
    panelFound: !!panel,
    badgeClass: badge?.className || null,
    emptyText: empty?.textContent?.trim() || null,
    statusText: statusText?.textContent?.trim() || null,
    disabledText: disabled?.textContent?.replace(/\s+/g, ' ').trim() || null,
    storyCount: stories.length,
    textPreview: text.slice(0, 300),
    waitingLike: /waiting for news data|等待新闻数据|waiting/i.test(text),
  };
});

const criticalConsole = consoleEvents.filter((c) => c.type === 'error' || c.type === 'warning');
const clusteringSignals = consoleEvents.filter((c) => /clustering failed|\[app\].*clustering|worker failed|analysisworker|cluster/i.test(c.text));

const report = {
  targetUrl,
  waitMs,
  gotoError,
  panelState,
  pageErrors,
  failedRequests: failedRequests.slice(0, 80),
  clusteringSignals,
  criticalConsole: criticalConsole.slice(-120),
  consoleTail: consoleEvents.slice(-200),
};

fs.writeFileSync('tmp-playwright-insights.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
