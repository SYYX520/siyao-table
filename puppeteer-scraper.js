const puppeteer = require('puppeteer');
const { parseCSV, generateOutput, SHEET_URL, SHEET_ID } = require('./scraper');
const fs = require('fs');
const path = require('path');

async function scrapeTencentDocs() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  console.log('Navigating to Tencent Docs...');
  await page.goto(SHEET_URL + '?opennew=1', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log('Selecting all cells...');
  await page.focus('canvas');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.waitForTimeout(500);

  console.log('Copying to clipboard...');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyC');
  await page.keyboard.up('Control');
  await page.waitForTimeout(2000);

  let csvData = await page.evaluate(() => {
    return navigator.clipboard.readText().catch(() => '');
  });

  if (!csvData || csvData.length < 50) {
    console.log('Clipboard read failed, trying alternative method...');
    const text = await page.evaluate(() => {
      return document.body.innerText;
    });
    csvData = text;
  }

  if (!csvData || csvData.length < 50) {
    console.log('Trying page content...');
    const html = await page.content();
    const match = html.match(/"initialData"\s*:\s*(\{.*?\})\s*[,;]/);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        csvData = JSON.stringify(data);
      } catch (e) { }
    }
  }

  await browser.close();

  if (!csvData || csvData.length < 50) {
    throw new Error('Failed to extract data from Tencent Docs');
  }

  console.log('Data extracted, length:', csvData.length);
  const accounts = parseCSV(csvData);
  console.log('Parsed accounts:', accounts.length);

  const output = generateOutput(accounts);
  const outputPath = path.join(__dirname, 'siyao_data.js');
  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log('Written to', outputPath);

  return accounts;
}

scrapeTencentDocs().then(accounts => {
  console.log(`Success! ${accounts.length} accounts scraped.`);
}).catch(err => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
