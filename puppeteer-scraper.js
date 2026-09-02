const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const { parseCSV, generateOutput, SHEET_URL } = require('./scraper');
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scrapeTencentDocs() {
  console.log('[1/6] Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');

  let apiData = null;

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('dop-api') || url.includes('opendoc') || url.includes('get/sheet')) {
      try {
        const text = await response.text();
        if (text.length > 200) {
          console.log('[network] URL:', url.substring(0, 120));
          console.log('[network] Response length:', text.length);
          if (text.includes('initialData') || text.includes('sheetData') || text.includes('"data"')) {
            apiData = text;
            console.log('[network] Found spreadsheet data!');
          }
        }
      } catch (e) { }
    }
  });

  console.log('[2/6] Navigating to Tencent Docs:', SHEET_URL);
  await page.goto(SHEET_URL + '?opennew=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('[2/6] Page loaded, waiting for content...');

  await sleep(8000);
  console.log('[3/6] Waiting complete, checking for API data...');

  if (apiData) {
    console.log('[3/6] Got data from network interception');
    console.log('[3/6] API data length:', apiData.length);
  } else {
    console.log('[3/6] No API data found, trying clipboard approach...');
  }

  let csvData = '';

  if (apiData) {
    try {
      const parsed = JSON.parse(apiData);
      if (parsed.initialData) {
        csvData = extractCSVFromInitialData(parsed.initialData);
      } else if (parsed.data) {
        csvData = extractCSVFromInitialData(parsed.data);
      }
      console.log('[4/6] Extracted CSV from API data, length:', csvData.length);
    } catch (e) {
      console.log('[4/6] Failed to parse API JSON, using raw data');
      csvData = apiData;
    }
  }

  if (!csvData || csvData.length < 50) {
    console.log('[4/6] Trying clipboard approach...');
    try {
      const frames = page.frames();
      console.log('[4/6] Page frames:', frames.length);

      for (const frame of frames) {
        const canvas = await frame.$('canvas');
        if (canvas) {
          console.log('[4/6] Found canvas in frame:', frame.url());
          await canvas.click();
          await sleep(500);
          break;
        }
      }

      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await sleep(500);

      await page.keyboard.down('Control');
      await page.keyboard.press('c');
      await page.keyboard.up('Control');
      await sleep(2000);

      try {
        csvData = execSync('xclip -selection clipboard -o', { encoding: 'utf-8', timeout: 5000 });
        console.log('[4/6] Clipboard data length:', csvData.length);
      } catch (e) {
        console.log('[4/6] xclip failed:', e.message);
        try {
          csvData = execSync('xsel --clipboard --output', { encoding: 'utf-8', timeout: 5000 });
          console.log('[4/6] xsel data length:', csvData.length);
        } catch (e2) {
          console.log('[4/6] xsel also failed:', e2.message);
        }
      }
    } catch (e) {
      console.log('[4/6] Clipboard approach failed:', e.message);
    }
  }

  if (!csvData || csvData.length < 50) {
    console.log('[5/6] Trying page.evaluate approach...');
    try {
      const text = await page.evaluate(() => {
        return document.body.innerText;
      });
      if (text && text.length > 50) {
        csvData = text;
        console.log('[5/6] Got body text, length:', csvData.length);
      }
    } catch (e) {
      console.log('[5/6] page.evaluate failed:', e.message);
    }
  }

  await browser.close();
  console.log('[6/6] Browser closed');

  if (!csvData || csvData.length < 50) {
    console.error('All methods failed. No data extracted.');
    console.error('Dumping page content for debugging...');
    try {
      const content = await page.content();
      fs.writeFileSync(path.join(__dirname, 'debug-page.html'), content.substring(0, 50000), 'utf-8');
      console.error('Page content saved to debug-page.html');
    } catch (e) { }
    throw new Error('Failed to extract data from Tencent Docs');
  }

  console.log('[6/6] Data extracted, length:', csvData.length);
  console.log('[6/6] First 200 chars:', csvData.substring(0, 200));

  const accounts = parseCSV(csvData);
  console.log('[6/6] Parsed accounts:', accounts.length);

  if (accounts.length === 0) {
    console.error('No accounts parsed from CSV data');
    console.error('CSV data sample:', csvData.substring(0, 500));
    fs.writeFileSync(path.join(__dirname, 'debug-raw-data.txt'), csvData, 'utf-8');
    console.error('Raw data saved to debug-raw-data.txt');
    throw new Error('No accounts parsed from data');
  }

  const output = generateOutput(accounts);
  const outputPath = path.join(__dirname, 'siyao_data.js');
  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log('[6/6] Written to', outputPath);

  return accounts;
}

function extractCSVFromInitialData(data) {
  try {
    if (data.sheetData && data.sheetData.length) {
      const rows = data.sheetData;
      return rows.map(row =>
        Array.isArray(row) ? row.map(cell => `"${cell || ''}"`).join(',') : ''
      ).join('\n');
    }
    if (data.initialData && data.initialData.sheetData) {
      return extractCSVFromInitialData(data.initialData);
    }
  } catch (e) {
    console.log('extractCSVFromInitialData error:', e.message);
  }
  return '';
}

scrapeTencentDocs().then(accounts => {
  console.log(`Success! ${accounts.length} accounts scraped.`);
}).catch(err => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
