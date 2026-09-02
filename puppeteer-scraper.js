const puppeteer = require('puppeteer');
const { parseCSV, generateOutput, SHEET_URL } = require('./scraper');
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SHEET_ID = 'BB08J2';
const DOC_ID = 'DQ1JtS0VqYXpVeHpU';

async function scrapeTencentDocs() {
  console.log('[1/4] Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');

  console.log('[2/4] Navigating to Tencent Docs:', SHEET_URL);
  await page.goto(SHEET_URL + '?opennew=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);
  console.log('[2/4] Page loaded');

  console.log('[3/4] Fetching cell data via API...');
  let csvData = '';

  try {
    const apiUrl = `https://docs.qq.com/dop-api/get/sheet?file_id=${DOC_ID}&sheet_id=${SHEET_ID}&start_row=0&end_row=31&start_col=0&end_col=15&return_csv=1`;
    console.log('[3/4] API URL:', apiUrl);

    const result = await page.evaluate(async (url) => {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        const text = await resp.text();
        return { status: resp.status, text };
      } catch (e) {
        return { status: 0, text: e.message };
      }
    }, apiUrl);

    console.log('[3/4] API status:', result.status);
    console.log('[3/4] Response length:', result.text.length);

    if (result.text.includes('csv_data')) {
      const jsonMatch = result.text.match(/"csv_data"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (jsonMatch) {
        csvData = JSON.parse('"' + jsonMatch[1] + '"');
        console.log('[3/4] Got CSV data, length:', csvData.length);
      }
    } else if (result.text.includes(',') && result.text.length > 200) {
      csvData = result.text;
      console.log('[3/4] Using raw response as CSV, length:', csvData.length);
    }
  } catch (e) {
    console.log('[3/4] API fetch failed:', e.message);
  }

  if (!csvData || csvData.length < 50) {
    console.log('[3/4] First API failed, trying alternative...');
    try {
      const result = await page.evaluate(async (docId, sheetId) => {
        const url = `https://docs.qq.com/dop-api/get/sheet?id=${docId}&tabId=${sheetId}&lc=1&return_csv=1`;
        try {
          const resp = await fetch(url, { credentials: 'include' });
          const text = await resp.text();
          return { status: resp.status, text };
        } catch (e) {
          return { status: 0, text: e.message };
        }
      }, DOC_ID, SHEET_ID);

      console.log('[3/4] Alt API status:', result.status);
      console.log('[3/4] Alt response length:', result.text.length);

      if (result.text.includes('csv_data')) {
        const jsonMatch = result.text.match(/"csv_data"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (jsonMatch) {
          csvData = JSON.parse('"' + jsonMatch[1] + '"');
          console.log('[3/4] Got CSV from alt API, length:', csvData.length);
        }
      }
    } catch (e) {
      console.log('[3/4] Alt API failed:', e.message);
    }
  }

  await browser.close();
  console.log('[4/4] Browser closed');

  if (!csvData || csvData.length < 50) {
    fs.writeFileSync(path.join(__dirname, 'debug-api-responses.txt'),
      'No CSV data obtained. Last response:\n' + (csvData || 'empty'), 'utf-8');
    throw new Error('No CSV data extracted');
  }

  console.log('[4/4] CSV length:', csvData.length);
  console.log('[4/4] First 200 chars:', csvData.substring(0, 200));

  const accounts = parseCSV(csvData);
  console.log('[4/4] Parsed accounts:', accounts.length);

  if (accounts.length === 0) {
    fs.writeFileSync(path.join(__dirname, 'debug-raw-data.txt'), csvData, 'utf-8');
    throw new Error('No accounts parsed');
  }

  const output = generateOutput(accounts);
  fs.writeFileSync(path.join(__dirname, 'siyao_data.js'), output, 'utf-8');
  console.log('[4/4] Written to siyao_data.js');

  return accounts;
}

scrapeTencentDocs().then(accounts => {
  console.log(`Success! ${accounts.length} accounts scraped.`);
}).catch(err => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
