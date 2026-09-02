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

  let allResponses = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('dop-api') || url.includes('opendoc') || url.includes('get/sheet') || url.includes('export')) {
      try {
        const text = await response.text();
        if (text && text.length > 100) {
          console.log('[net] URL:', url.substring(0, 150));
          console.log('[net] Length:', text.length);
          console.log('[net] First 300:', text.substring(0, 300));
          allResponses.push({ url, text, length: text.length });
        }
      } catch (e) { }
    }
  });

  console.log('[2/6] Navigating to:', SHEET_URL);
  await page.goto(SHEET_URL + '?opennew=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('[2/6] Page loaded, waiting...');
  await sleep(8000);

  console.log('[3/6] Captured', allResponses.length, 'API responses');
  let csvData = '';

  for (const resp of allResponses) {
    console.log('[3/6] Trying response from:', resp.url.substring(0, 80));
    try {
      const parsed = JSON.parse(resp.text);
      console.log('[3/6] JSON keys:', Object.keys(parsed).join(', '));

      csvData = extractDataFromJSON(parsed);
      if (csvData && csvData.length > 50) {
        console.log('[3/6] Got CSV data from JSON, length:', csvData.length);
        break;
      }

      for (const key of Object.keys(parsed)) {
        const val = parsed[key];
        if (typeof val === 'object' && val !== null) {
          console.log('[3/6] Checking key:', key, 'type:', Array.isArray(val) ? 'array' : 'object');
          csvData = extractDataFromJSON(val);
          if (csvData && csvData.length > 50) {
            console.log('[3/6] Got CSV from key:', key, 'length:', csvData.length);
            break;
          }
        }
      }
      if (csvData && csvData.length > 50) break;
    } catch (e) {
      if (resp.text.includes('\t') || resp.text.includes(',')) {
        csvData = resp.text;
        console.log('[3/6] Using raw text as CSV, length:', csvData.length);
        break;
      }
    }
  }

  if (!csvData || csvData.length < 50) {
    console.log('[4/6] Trying clipboard with xclip...');
    try {
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
        console.log('[4/6] xclip data length:', csvData.length);
      } catch (e) {
        console.log('[4/6] xclip failed:', e.message);
      }
    } catch (e) {
      console.log('[4/6] Clipboard failed:', e.message);
    }
  }

  if (!csvData || csvData.length < 50) {
    console.log('[5/6] Saving all API responses for debugging...');
    const debugData = allResponses.map(r => `=== URL: ${r.url} ===\nLength: ${r.length}\n${r.text.substring(0, 2000)}\n`).join('\n');
    fs.writeFileSync(path.join(__dirname, 'debug-api-responses.txt'), debugData, 'utf-8');
    console.log('[5/6] Saved to debug-api-responses.txt');
  }

  await browser.close();
  console.log('[6/6] Browser closed');

  if (!csvData || csvData.length < 50) {
    throw new Error('No data extracted. Check debug-api-responses.txt');
  }

  console.log('[6/6] Data length:', csvData.length);
  console.log('[6/6] First 300 chars:', csvData.substring(0, 300));

  const accounts = parseCSV(csvData);
  console.log('[6/6] Parsed accounts:', accounts.length);

  if (accounts.length === 0) {
    fs.writeFileSync(path.join(__dirname, 'debug-raw-data.txt'), csvData, 'utf-8');
    console.log('[6/6] Raw data saved to debug-raw-data.txt');
    throw new Error('No accounts parsed from data');
  }

  const output = generateOutput(accounts);
  fs.writeFileSync(path.join(__dirname, 'siyao_data.js'), output, 'utf-8');
  console.log('[6/6] Written to siyao_data.js');

  return accounts;
}

function extractDataFromJSON(obj) {
  if (!obj || typeof obj !== 'object') return '';

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '';
    const first = obj[0];
    if (Array.isArray(first)) {
      return obj.map(row => row.map(c => `"${c || ''}"`).join(',')).join('\n');
    }
    if (typeof first === 'object' && first !== null) {
      return obj.map(row => Object.values(row).map(c => `"${c || ''}"`).join(',')).join('\n');
    }
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val) && val.length > 0) {
      const result = extractDataFromJSON(val);
      if (result && result.length > 50) return result;
    }
    if (typeof val === 'object' && val !== null) {
      const result = extractDataFromJSON(val);
      if (result && result.length > 50) return result;
    }
  }

  return '';
}

scrapeTencentDocs().then(accounts => {
  console.log(`Success! ${accounts.length} accounts scraped.`);
}).catch(err => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
