const cheerio = require('cheerio');

/**
 * 中国政府采购网搜索爬取代理
 * GET /api/crawl?kw=关键词&page_index=1&start_time=2026-01-01&end_time=2026-07-28
 */
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { kw = '医疗设备', page_index = 1, start_time, end_time } = req.query;
  const pageIndex = Math.max(1, Math.min(parseInt(page_index) || 1, 50));

  // 构建请求 URL
  let url = `http://search.ccgp.gov.cn/bxsearch?searchtype=1&kw=${encodeURIComponent(kw)}&page_index=${pageIndex}`;
  if (start_time) {
    url += `&start_time=${encodeURIComponent(start_time)}`;
  }
  if (end_time) {
    url += `&end_time=${encodeURIComponent(end_time)}`;
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `ccgp 返回 ${response.status}`, products: [], total: 0 });
    }

    const html = await response.text();
    const products = parseResults(html);

    return res.status(200).json({
      products,
      total: products.length,
      page: pageIndex,
      keyword: kw,
    });
  } catch (err) {
    console.error('crawl error:', err.message);
    return res.status(500).json({ error: err.message, products: [], total: 0 });
  }
};

/**
 * 解析 ccgp 搜索结果 HTML，提取结构化数据
 */
function parseResults(html) {
  const $ = cheerio.load(html);
  const products = [];

  // ccgp 页面搜索结果通常放在 <ul> 内的 <li> 中，每个 <li> 包含一条公告
  const items = $('ul > li').filter((_, el) => {
    const t = $(el).text();
    return t.includes('采购人') || t.includes('代理机构');
  });

  if (items.length === 0) {
    return fallbackParse(html);
  }

  items.each((_, el) => {
    const $el = $(el);
    const fullText = $el.text().replace(/\s+/g, ' ').trim();
    if (!fullText || fullText.length < 10) return;

    // 标题：<a> 标签内的文本，或第一段有意义的文字
    const titleLink = $el.find('a').first();
    let title = '';
    if (titleLink.length) {
      title = titleLink.text().replace(/\s+/g, ' ').trim();
    } else {
      // 取日期之前的文本作为标题
      const dateIdx = fullText.search(/\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}/);
      title = dateIdx > 0 ? fullText.substring(0, dateIdx).trim() : fullText.split(/\s{2,}/)[0].trim();
    }
    title = title.slice(0, 150);

    // 日期
    const dateMatch = fullText.match(/(\d{4}\.\d{2}\.\d{2})\s+\d{2}:\d{2}:\d{2}/);
    const date = dateMatch ? dateMatch[1] : '';

    // 采购人
    const purchaserMatch = fullText.match(/采购人[：:]\s*(.+?)(?:\s{2,}|\||代理机构|$)/);
    const purchaser = purchaserMatch ? purchaserMatch[1].trim() : '';

    // 代理机构
    const agencyMatch = fullText.match(/代理机构[：:]\s*(.+?)(?:\s{2,}|\||$)/);
    const agency = agencyMatch ? agencyMatch[1].trim() : '';

    // 公告类型
    const typeMatch = fullText.match(/(中标公告|中标结果公告|公开招标公告|废标公告|竞争性磋商公告|单一来源|询价公告|其他公告|更正公告|成交结果公告)/);
    const noticeType = typeMatch ? typeMatch[1] : '';

    // 项目编号
    const bidMatch = fullText.match(/项目编号[：:]\s*([A-Za-z0-9-_]+)/);
    const bidCode = bidMatch ? bidMatch[1].trim() : '';

    // 医院名称（从标题或采购人中提取）
    const hospital = extractHospital(title, purchaser);

    // 类别
    const category = extractCategory(fullText, title);

    // 省份
    const province = extractProvince(fullText);

    const cert = bidCode || `ZB-${date.replace(/\./g, '')}-${String(products.length + 1).padStart(3, '0')}`;

    products.push({
      name: title,
      cert: cert,
      company: purchaser || hospital,
      hospital: hospital || purchaser,
      category: category,
      date: date,
      province: province,
      source: '医院招标',
      noticeType: noticeType,
    });
  });

  return products;
}

function extractHospital(title, purchaser) {
  const patterns = [
    /(.+?(?:医院|卫生院|社区卫生服务中心|疾控中心|妇幼保健|急救中心))/,
    /((?:北京|上海|天津|重庆|广东|江苏|浙江|山东|四川|湖北|湖南|福建|安徽|河南|河北|辽宁|吉林|黑龙江|江西|山西|陕西|甘肃|青海|云南|贵州|海南|西藏|广西|内蒙古|宁夏|新疆)\S*?(?:医院|卫生院|中心医院|人民医院|中医院))/,
  ];

  for (const p of patterns) {
    const m = title.match(p);
    if (m) return m[1];
  }

  if (purchaser) {
    const pm = purchaser.match(/(.+?(?:医院|卫生院))/);
    if (pm) return pm[1];
    return purchaser;
  }

  return '';
}

function extractCategory(text, title) {
  const categories = [
    'CT', 'MRI', 'PET-CT', 'DSA', 'DR', 'CR', 'X线', 'X射线',
    '彩超', '超声', 'B超', '内镜', '内窥镜', '腹腔镜', '宫腔镜',
    '呼吸机', '麻醉机', '监护仪', '除颤仪', '心电图',
    '透析', '血透', 'CRRT',
    '手术机器人', '达芬奇',
    '生化分析', '血球分析', '检验',
    '核酸', 'PCR',
    '医用耗材', '一次性', '植入', '导管',
    '康复', '理疗',
    '病床', '手术床', '无影灯',
    '救护车', '急救',
    '信息化', 'HIS', 'PACS',
    '维保', '售后服务',
    '以旧换新',
  ];

  for (const cat of categories) {
    if (title.includes(cat) || text.includes(cat)) return cat + '设备';
  }
  return '医疗设备';
}

function extractProvince(text) {
  const provinces = [
    '北京', '上海', '天津', '重庆',
    '广东', '江苏', '浙江', '山东', '四川', '湖北', '湖南', '福建',
    '安徽', '河南', '河北', '辽宁', '吉林', '黑龙江', '江西', '山西',
    '陕西', '甘肃', '青海', '云南', '贵州', '海南',
    '广西', '内蒙古', '宁夏', '新疆', '西藏',
  ];

  // 优先匹配最后出现的省份
  const allMatches = [];
  for (const p of provinces) {
    let idx = -1;
    while ((idx = text.indexOf(p, idx + 1)) !== -1) {
      allMatches.push({ prov: p, idx });
    }
  }
  allMatches.sort((a, b) => b.idx - a.idx);
  return allMatches.length > 0 ? allMatches[0].prov : '';
}

/**
 * 备选方案：正则直接从 HTML 文本提取
 */
function fallbackParse(html) {
  const products = [];
  const text = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

  // 按日期拆分每个结果块
  const blocks = text.split(/(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})/);
  for (let i = 0; i < blocks.length - 1; i += 2) {
    const block = blocks[i];
    const date = blocks[i + 1].trim();

    const lines = block.split('\n').filter(l => l.trim().length > 5);
    if (lines.length === 0) continue;

    const title = lines[0].replace(/\s+/g, ' ').trim().slice(0, 150);
    const fullText = block;

    const purchaserMatch = fullText.match(/采购人[：:]\s*(.+?)(?:\s|$|代理|项目)/);
    const purchaser = purchaserMatch ? purchaserMatch[1].trim() : '';

    const hospital = extractHospital(title, purchaser);
    const category = extractCategory(fullText, title);
    const province = extractProvince(fullText);
    const dateClean = date.split(' ')[0];

    products.push({
      name: title,
      cert: `ZB-${dateClean.replace(/\./g, '')}-${products.length + 1}`,
      company: purchaser || hospital,
      hospital: hospital || purchaser,
      category: category,
      date: dateClean,
      province: province,
      source: '医院招标',
      noticeType: '',
    });
  }

  return products;
}
