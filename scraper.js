const fs = require('fs');
const path = require('path');

const SHEET_URL = 'https://docs.qq.com/sheet/DQ1JtS0VqYXpVeHpU';
const SHEET_ID = 'BB08J2';

function parseCSV(csvText) {
  const lines = csvText.split('\n');
  const accounts = [];

  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length < 15) continue;
    const wid = cols[2];
    if (!wid || wid === '编号' || wid === '全包（标价是带aw或者刘涛的价格）' || wid === '砖' || wid.trim() === '') continue;

    const deposit = parseInt(cols[1]) || 0;
    const huffStr = cols[3].replace(/[mM]/g, '').trim();
    const huff = parseInt(huffStr) || 0;
    const safeBoxStr = cols[4].trim();
    const salePrice = parseFloat(cols[5]) || 0;
    const ratioStr = cols[6].replace(/[比]/g, '').trim();
    const ratio = parseInt(ratioStr) || 0;
    const stamina = parseInt(cols[7]) || 0;
    const weight = parseInt(cols[8]) || 0;
    const rank = cols[9].trim();
    const knifeSkinStr = cols[10].trim();
    const skinStr = cols[11].trim();
    const awRedBulletStr = cols[12].trim();
    const loginTypeStr = cols[13].trim();
    const remark = cols[14].trim();

    const safeBox = safeBoxStr.includes('九格') || safeBoxStr.includes('9格') ? '顶级(3*3)' : (safeBoxStr.includes('六格') || safeBoxStr.includes('6格') ? '高级(2*3)' : safeBoxStr);
    const loginType = loginTypeStr.includes('微信') ? '微信扫码' : (loginTypeStr.includes('账密') ? 'QQ账密' : 'QQ扫码');

    const knifeSkins = knifeSkinStr ? knifeSkinStr.split(/[，,]/).map(s => s.trim()).filter(Boolean) : [];
    const allSkins = skinStr ? skinStr.split(/[，,]/).map(s => s.trim()).filter(Boolean) : [];

    let awm = 0, redBullet = 0, helmet = 0, armor = 0;
    const awMatch = awRedBulletStr.match(/(\d+)\s*aw/i);
    if (awMatch) awm = parseInt(awMatch[1]);
    const redMatch = awRedBulletStr.match(/(\d+)\s*红弹/);
    if (redMatch) redBullet = parseInt(redMatch[1]);
    const headMatch = awRedBulletStr.match(/(\d+)\s*头/);
    if (headMatch) helmet = parseInt(headMatch[1]);
    const armorMatch = awRedBulletStr.match(/(\d+)\s*甲/);
    if (armorMatch) armor = parseInt(armorMatch[1]);

    const rankVal = { '白银': 2, '黄金': 3, '铂金': 4, '钻石': 5, '黑鹰': 6, '巅峰': 7 }[rank.replace(/\d+$/, '')] || 0;
    const total = Math.round((salePrice) * 100) / 100;
    const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

    accounts.push({
      wid, kf: '', source: '腾讯文档', domain: 'docs.qq.com', status: '在售',
      ratio, huff, rank, rank_val: rankVal, level: 60, kd: 0,
      rent_days: 0, time_range: '', login_type: loginType, login_region: '',
      safe_box: safeBox, stamina, weight_capacity: weight,
      sale_price: salePrice, deposit, equi_rent: 0, total_price: total,
      helmet, armor, awm, red_bullet: redBullet,
      knife_skin: knifeSkins, weapon_skin: [], gold_skin: [], red_skin: [],
      knife_skin_names: knifeSkins, weapon_skin_names: [], gold_skin_names: [], red_skin_names: [],
      remark, is_special: 0, is_exp_card: 0, last_seen: nowStr, first_seen: nowStr
    });
  }
  return accounts;
}

function generateOutput(accounts) {
  const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  return `// Auto-generated from Tencent Docs at ${nowStr}\n// Source: ${SHEET_URL}\n// Total: ${accounts.length} accounts\nwindow.SCRAPED_RENTAL_DATA = ${JSON.stringify(accounts)};\n`;
}

module.exports = { parseCSV, generateOutput, SHEET_URL, SHEET_ID };

if (require.main === module) {
  const csvFile = process.argv[2];
  if (!csvFile) {
    console.error('Usage: node scraper.js <csv_file>');
    process.exit(1);
  }
  const csvText = fs.readFileSync(csvFile, 'utf-8');
  const accounts = parseCSV(csvText);
  const output = generateOutput(accounts);
  fs.writeFileSync(path.join(__dirname, 'siyao_data.js'), output, 'utf-8');
  console.log(`Written ${accounts.length} accounts to siyao_data.js`);
}
