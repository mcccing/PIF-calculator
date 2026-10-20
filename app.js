'use strict';

/* ================= 常量 ================= */
const STAT_ORDER = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed', 'Total'];
const STAT_LABELS = {
  'HP': 'HP', 'Attack': '攻击', 'Defense': '防御',
  'Sp. Atk': '特攻', 'Sp. Def': '特防', 'Speed': '速度', 'Total': '总和'
};
const DATA_LABELS = { 'Height': '身高', 'Weight': '体重' };

const STAT_MAP = {
  'HP': 'HP', 'Attack': 'Attack', 'Defense': 'Defense',
  'Special Attack': 'Sp. Atk', 'Special Defense': 'Sp. Def',
  'Speed': 'Speed', 'Total': 'Total'
};

/* 公共 CORS 代理，按顺序降级尝试 */
const CORS_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

/* ================= 名称字典 ================= */
let ZH_TO_EN = {};
let dictReady = false;

async function loadDictionary() {
  try {
    const [zhRes, enRes] = await Promise.all([
      fetch('./zh-hans.json'),
      fetch('./en.json')
    ]);
    const zhList = await zhRes.json();
    const enList = await enRes.json();
    const map = {};
    const n = Math.min(zhList.length, enList.length);
    for (let i = 0; i < n; i++) map[zhList[i]] = enList[i];
    ZH_TO_EN = map;
    dictReady = true;
    console.log(`名称字典加载完成：${n} 条`);
  } catch (e) {
    console.warn('加载名称字典失败，中文输入功能受限：', e);
  }
}

function formatNameForUrl(name) {
  name = (name || '').trim();
  if (ZH_TO_EN[name]) name = ZH_TO_EN[name];          // 中文 → 英文
  name = name.toLowerCase();
  name = name.replace(/'/g, '').replace(/\./g, '');   // 去单引号、点
  name = name.replace(/♀/g, '-f').replace(/♂/g, '-m');
  name = name.replace(/é/g, 'e');
  name = name.replace(/ /g, '-');
  name = name.replace(/-+/g, '-');
  return name;
}

/* ================= 工具 ================= */
function toInt(value) {
  if (value === null || value === undefined) return null;
  const n = parseInt(String(value).trim(), 10);
  return Number.isNaN(n) ? null : n;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/* ================= 解析 fusiondex 页面 ================= */
function parseFusionPage(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const article = doc.querySelector('#content article');
  if (!article) return { error: '未找到该宝可梦或融合形态，请检查名字拼写' };

  // 标题
  const h2 = article.querySelector('h2');
  const title = h2 ? h2.textContent.trim() : '';

  // 属性
  const typeSpans = article.querySelectorAll('section.types span.type span');
  const types = [];
  typeSpans.forEach(s => {
    const t = s.textContent.trim();
    if (t) types.push(t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  });
  const typeStr = types.length ? types.join(' + ') : 'Unknown';

  // 种族值
  const stats = {};
  const statsDl = article.querySelector('dl.stats');
  if (statsDl) {
    let currentKey = null;
    Array.from(statsDl.children).forEach(child => {
      if (child.tagName === 'DT') {
        currentKey = child.textContent.trim();
      } else if (child.tagName === 'DD') {
        if (child.classList.contains('progress')) return;
        if (currentKey) {
          stats[currentKey] = child.textContent.trim();
          currentKey = null;
        }
      }
    });
  }
  const normalizedStats = {};
  Object.keys(stats).forEach(k => {
    normalizedStats[STAT_MAP[k] || k] = stats[k];
  });

  // 其他数据（跳过 Category）
  const dataLines = [];
  const dataDl = article.querySelector('dl.data');
  if (dataDl) {
    let currentKey = null;
    Array.from(dataDl.children).forEach(child => {
      if (child.tagName === 'DT') {
        currentKey = child.textContent.trim();
      } else if (child.tagName === 'DD') {
        if (currentKey) {
          if (currentKey === 'Category') { currentKey = null; return; }
          const label = DATA_LABELS[currentKey] || currentKey;
          dataLines.push(`${label}: ${child.textContent.trim()}`);
          currentKey = null;
        }
      }
    });
  }

  return { title, types: typeStr, stats: normalizedStats, data_lines: dataLines };
}

/* ================= 格式化输出 ================= */
function formatParsed(parsed, diff) {
  if (parsed.error) return parsed.error;

  const lines = [];
  if (parsed.title) lines.push(parsed.title);
  lines.push(`属性: ${parsed.types || 'Unknown'}`);
  lines.push('');

  const stats = parsed.stats || {};
  if (Object.keys(stats).length) {
    lines.push('种族:');
    for (const key of STAT_ORDER) {
      if (key in stats) {
        const label = STAT_LABELS[key] || key;
        let suffix = '';
        if (diff && diff[key] !== undefined && diff[key] !== 0) {
          const d = diff[key];
          suffix = `  (${d > 0 ? '+' : ''}${d})`;
        }
        lines.push(`${label}: ${stats[key]}${suffix}`);
      }
    }
    lines.push('');
  }

  const dataLines = parsed.data_lines || [];
  if (dataLines.length) {
    lines.push('数据:');
    lines.push(...dataLines);
  }

  return lines.join('\n').replace(/\s+$/, '');
}

function renderResult(text) {
  let html = escapeHtml(text);
  // 差异高亮
  html = html
    .replace(/\((\+\d+)\)/g, '<span class="pos">($1)</span>')
    .replace(/\((-\d+)\)/g, '<span class="neg">($1)</span>');
  // 章节前缀高亮
  html = html.replace(/^(属性:|种族:|数据:)/gm, '<span class="section">$1</span>');
  // 首行标题
  const lines = html.split('\n');
  if (lines.length > 0) lines[0] = `<span class="title">${lines[0]}</span>`;
  return lines.join('\n');
}

/* ================= 抓取 ================= */
async function fetchOne(targetUrl) {
  let lastErr = null;
  for (const makeProxy of CORS_PROXIES) {
    try {
      const res = await fetch(makeProxy(targetUrl), { signal: timeoutSignal(15000) });
      if (res.status === 404) {
        return { error: '未找到该宝可梦或融合形态，请检查名字拼写' };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < 80) throw new Error('响应内容过短');
      return parseFusionPage(text);
    } catch (e) {
      lastErr = e;
    }
  }
  return { error: `网络请求失败：${lastErr ? lastErr.message : '未知错误'}` };
}

async function fetchContent(nameA, nameB) {
  const base = 'https://www.fusiondex.org';
  const ua = formatNameForUrl(nameA);
  const ub = formatNameForUrl(nameB);
  const urls = [`${base}/${ua}+${ub}/`, `${base}/${ub}+${ua}/`];
  return Promise.all(urls.map(fetchOne));
}

/* ================= UI ================= */
const $ = sel => document.querySelector(sel);
const els = {
  entryA: $('#name-a'),
  entryB: $('#name-b'),
  btnCompare: $('#btn-compare'),
  titleLeft: $('#title-left'),
  titleRight: $('#title-right'),
  resultLeft: $('#result-left'),
  resultRight: $('#result-right'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
};

function setStatus(text, cls) {
  els.statusText.textContent = text;
  els.statusDot.className = 'dot' + (cls ? ' ' + cls : '');
}

function setBusy(busy) {
  els.btnCompare.disabled = busy;
}

async function startCompare() {
  const nameA = els.entryA.value.trim();
  const nameB = els.entryB.value.trim();
  if (!nameA || !nameB) {
    alert('请输入两个名称！');
    return;
  }

  setBusy(true);
  setStatus('正在抓取数据，请稍候...', 'busy');

  try {
    const [contentAB, contentBA] = await fetchContent(nameA, nameB);
    const engA = formatNameForUrl(nameA);
    const engB = formatNameForUrl(nameB);
    els.titleLeft.textContent = `${engA} + ${engB}`;
    els.titleRight.textContent = `${engB} + ${engA}`;

    // 种族值差异
    const diffAB = {}, diffBA = {};
    const statsAB = contentAB.stats || {};
    const statsBA = contentBA.stats || {};
    for (const key of STAT_ORDER) {
      const va = toInt(statsAB[key]);
      const vb = toInt(statsBA[key]);
      if (va !== null && vb !== null) {
        const d = va - vb;
        if (d !== 0) {
          diffAB[key] = d;
          diffBA[key] = -d;
        }
      }
    }

    els.resultLeft.innerHTML = renderResult(formatParsed(contentAB, diffAB));
    els.resultRight.innerHTML = renderResult(formatParsed(contentBA, diffBA));
    els.resultLeft.scrollTop = 0;  els.resultLeft.scrollLeft = 0;
    els.resultRight.scrollTop = 0; els.resultRight.scrollLeft = 0;

    if (contentAB.error || contentBA.error) {
      setStatus('部分数据获取失败', 'err');
    } else {
      setStatus('完成', 'ok');
    }
  } catch (e) {
    setStatus('发生错误', 'err');
    alert(`处理过程中出现错误：\n${e.message || e}`);
  } finally {
    setBusy(false);
  }
}

/* 左右滚动同步 */
function bindSyncScroll(a, b) {
  let lock = false;
  const sync = (src, dst) => () => {
    if (lock) return;
    lock = true;
    dst.scrollTop = src.scrollTop;
    dst.scrollLeft = src.scrollLeft;
    requestAnimationFrame(() => { lock = false; });
  };
  a.addEventListener('scroll', sync(a, b));
  b.addEventListener('scroll', sync(b, a));
}

/* ================= 初始化 ================= */
async function init() {
  bindSyncScroll(els.resultLeft, els.resultRight);
  els.btnCompare.addEventListener('click', startCompare);
  els.entryA.addEventListener('keydown', e => { if (e.key === 'Enter') startCompare(); });
  els.entryB.addEventListener('keydown', e => { if (e.key === 'Enter') startCompare(); });

  await loadDictionary();
  setStatus('就绪', 'idle');
}

init();
