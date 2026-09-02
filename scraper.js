const https = require('https');
const fs = require('fs');
const path = require('path');

const REMOTE_SOURCES = [
  { name: "xy商行", domain: "xy.jqka.cc" },
  { name: "h8商行", domain: "h8.jqka.cc" },
  { name: "91商行", domain: "91.jqka.cc" },
  { name: "天稳商行", domain: "tj.jqka.cc" }
];

const CORS_PROXIES = [
  (url) => 'https://proxy.cors.sh/' + url,
  (url) => 'https://corsproxy.io/?url=' + encodeURIComponent(url),
  (url) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)
];

const RANK_MAP = { 0: "无段位", 1: "青铜", 2: "白银", 3: "黄金", 4: "铂金", 5: "钻石", 6: "黑鹰", 7: "巅峰" };
const LOGIN_MAP = { 0: "未知", 1: "QQ扫码", 2: "微信扫码", 3: "QQ账密" };
const SAFE_BOX_MAP = { 0: "0", 1: "进阶(2*2)", 2: "高级(2*3)", 3: "顶级(3*3)", 6: "高级(2*3)", 9: "顶级(3*3)" };

const FILTER_CONDITIONS = [
  { label: '6格7体7负', game_safe_box: 6, game_stamina: 7, game_weight_capacity: 7 },
  { label: '9格7体6负', game_safe_box: 9, game_stamina: 7, game_weight_capacity: 6 },
  { label: '9格7体7负', game_safe_box: 9, game_stamina: 7, game_weight_capacity: 7 }
];

function fetchViaProxy(proxyIdx, apiUrl, postBody) {
  return new Promise((resolve, reject) => {
    const errors = [];
    let currentProxy = proxyIdx;

    function tryNext() {
      if (currentProxy >= CORS_PROXIES.length) {
        reject(new Error(errors.join('; ')));
        return;
      }

      const proxyUrl = CORS_PROXIES[currentProxy](apiUrl);
      const urlObj = new URL(proxyUrl);
      const postData = JSON.stringify(postBody);

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            errors.push(`proxy${currentProxy}:HTTP${res.statusCode}`);
            currentProxy++;
            tryNext();
            return;
          }
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            errors.push(`proxy${currentProxy}:parse_error`);
            currentProxy++;
            tryNext();
          }
        });
      });

      req.on('error', (e) => {
        errors.push(`proxy${currentProxy}:${e.message}`);
        currentProxy++;
        tryNext();
      });

      req.on('timeout', () => {
        req.destroy();
        errors.push(`proxy${currentProxy}:timeout`);
        currentProxy++;
        tryNext();
      });

      req.write(postData);
      req.end();
    }

    tryNext();
  });
}

function parseSkin(skinVal) {
  if (!skinVal || skinVal === 'None' || skinVal === null) return [];
  if (Array.isArray(skinVal)) return skinVal;
  if (typeof skinVal === 'string') return skinVal.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function parseEqui(equiJsonStr) {
  const result = { helmet: 0, armor: 0, awm: 0, red_bullet: 0 };
  if (!equiJsonStr) return result;
  try {
    const data = typeof equiJsonStr === 'string' ? JSON.parse(equiJsonStr) : equiJsonStr;
    for (const k in data) {
      if (k === '-999') continue;
      const name = data[k].name || '';
      const count = data[k].count || 0;
      if (name.indexOf('6级头') >= 0) result.helmet = count;
      else if (name.indexOf('6级甲') >= 0) result.armor = count;
      else if (name.indexOf('AWM') >= 0 || name.indexOf('awm') >= 0) result.awm = count;
      else if (name.indexOf('红弹') >= 0 || name.indexOf('红色子弹') >= 0) result.red_bullet = count;
    }
  } catch (e) { }
  return result;
}

function formatAccount(acc, sourceName, domain) {
  const equi = parseEqui(acc.game_buy_equi_json);
  const timeRange = (acc.game_time_range_start != null && acc.game_time_range_end != null)
    ? `${acc.game_time_range_start}点-${acc.game_time_range_end}点` : '';
  const rankVal = acc.game_rank || 0;
  const rankText = RANK_MAP[rankVal] || '无段位';
  const loginVal = acc.login_type || 0;
  const loginText = LOGIN_MAP[loginVal] || '未知';
  const safeBoxVal = acc.game_safe_box || 0;
  const safeBoxText = SAFE_BOX_MAP[safeBoxVal] || String(safeBoxVal);
  const salePrice = acc.game_sale_price || 0;
  const deposit = acc.game_sale_deposit || 0;
  const equiRent = acc.game_sale_equi_rental_fee || 0;
  const total = Math.round((salePrice + equiRent) * 100) / 100;
  const knifeIds = parseSkin(acc.game_special_knife_skin);
  const weaponIds = parseSkin(acc.game_weapon_skin);
  const goldIds = parseSkin(acc.game_character_gold_skin);
  const redIds = parseSkin(acc.game_character_red_skin);
  const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  return {
    wid: acc.sale_user || '', kf: acc.kf || '', source: sourceName, domain, status: '在售',
    ratio: acc.game_sale_ratio || 0, huff: acc.game_huff || 0,
    rank: rankText, rank_val: rankVal, level: acc.game_level || 0, kd: acc.game_kd || 0,
    rent_days: acc.game_rent_days || 0, time_range: timeRange, login_type: loginText,
    login_region: acc.login_region || '', safe_box: safeBoxText,
    stamina: acc.game_stamina || 0, weight_capacity: acc.game_weight_capacity || 0,
    sale_price: salePrice, deposit, equi_rent: equiRent, total_price: total,
    helmet: equi.helmet, armor: equi.armor, awm: equi.awm, red_bullet: equi.red_bullet,
    knife_skin: knifeIds, weapon_skin: weaponIds, gold_skin: goldIds, red_skin: redIds,
    remark: acc.remark || '', is_special: acc.is_special_price || 0,
    is_exp_card: acc.game_exp_card || 0, last_seen: nowStr, first_seen: nowStr
  };
}

async function scrapeSource(src) {
  const sourceAccounts = [];
  let sourceOk = false;

  for (const cond of FILTER_CONDITIONS) {
    let page = 1;
    try {
      while (page <= 50) {
        const postBody = {
          page, size: 100,
          game_safe_box: cond.game_safe_box,
          game_stamina: cond.game_stamina,
          game_weight_capacity: cond.game_weight_capacity,
          sort_field: 'game_sale_ratio', sort_order: 'desc'
        };
        const apiUrl = `https://${src.domain}/api/game/account/list`;
        const data = await fetchViaProxy(0, apiUrl, postBody);
        const items = data.data && data.data.result ? data.data.result
          : (data.data && data.data.list ? data.data.list : []);
        if (!items || !items.length) break;
        for (const item of items) sourceAccounts.push(formatAccount(item, src.name, src.domain));
        const totalPages = data.data && data.data.totalPages ? data.data.totalPages : 1;
        if (page >= totalPages) break;
        page++;
      }
      sourceOk = true;
    } catch (e) { }
  }

  const seen = {};
  const unique = sourceAccounts.filter(a => {
    if (seen[a.wid]) return false;
    seen[a.wid] = true;
    return true;
  });
  unique.sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
  return { name: src.name, status: sourceOk ? 'ok' : 'error', count: unique.length, data: unique };
}

async function main() {
  console.log('Starting scrape at', new Date().toISOString());
  const allAccounts = [];
  const results = [];

  for (const src of REMOTE_SOURCES) {
    process.stdout.write(`  Scraping ${src.name} (${src.domain})... `);
    try {
      const result = await scrapeSource(src);
      allAccounts.push(...result.data);
      results.push(result);
      console.log(`${result.count} accounts`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      results.push({ name: src.name, status: 'error', count: 0, data: [] });
    }
  }

  const onSale = allAccounts.filter(a => a.status === '在售').length;
  console.log(`\nTotal: ${allAccounts.length} accounts (${onSale} on sale)`);

  const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const output = `// Auto-generated by scraper.js at ${nowStr}\n// Total: ${allAccounts.length} accounts (${onSale} on sale)\nwindow.SCRAPED_RENTAL_DATA = ${JSON.stringify(allAccounts)};\n`;

  const outputPath = path.join(__dirname, 'siyao_data.js');
  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log(`Data written to ${outputPath}`);

  const summary = {
    timestamp: nowStr,
    total: allAccounts.length,
    on_sale: onSale,
    sources: results.map(r => ({ name: r.name, status: r.status, count: r.count }))
  };
  fs.writeFileSync(path.join(__dirname, 'scrape-result.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log('Summary:', JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error('Scrape failed:', e); process.exit(1); });
