'use strict';

/* =====================================================
 * Emby Icon Studio
 * 纯前端实现：GitHub Pages + GitHub REST API
 * 浏览器 → localStorage → GitHub API
 * ===================================================== */

// ---------- 常量 ----------
const CONFIG_KEY = 'eis_github_config';
const CACHE_KEY = 'eis_icons_cache';
const CACHE_TTL = 5 * 60 * 1000; // 图标索引缓存 5 分钟
const OUT_SIZE = 512;            // 输出统一 512×512
const MIN_ZOOM = 50;
const MAX_ZOOM = 300;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const PINYIN_CDN = 'https://cdn.jsdelivr.net/npm/pinyin-pro@3/dist/index.min.js';

// ---------- 状态 ----------
let config = readConfig();
let icons = [];
let editor = null;        // { img, w, h, x, y, zoom, opacity, shape }
let currentFile = null;   // 当前编辑图片的 ObjectURL
let confirmHandler = null;    // 确认弹窗回调
let pendingRename = null;
let cacheBust = 0;        // 上传/删除后刷新缩略图缓存
let renderLimit = 120;    // 图标太多时分批渲染，避免一次性建上千个节点
let pinyinLoader = null;

// ---------- DOM 工具 ----------
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ---------- 配置 ----------
function readConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null; }
  catch { return null; }
}

function isConfigReady(c = config) {
  return !!(c && c.owner && c.repo && c.branch && c.dir && c.token);
}

function requireConfig() {
  if (isConfigReady()) return true;
  openSettings();
  showToast('请先完成 GitHub 配置', 'err');
  return false;
}

function updateRepoLink() {
  const a = $('repoLink');
  if (isConfigReady()) {
    a.hidden = false;
    a.href = `https://github.com/${config.owner}/${config.repo}`;
  } else {
    a.hidden = true;
  }
}

// ---------- 主题：跟随系统 / 浅色 / 深色 ----------
const THEME_KEY = 'eis_theme'; // 'system' | 'light' | 'dark'
const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_META = {
  system: { icon: '🌓', label: '跟随系统' },
  light: { icon: '☀️', label: '浅色' },
  dark: { icon: '🌙', label: '深色' }
};

function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; }
  catch { return 'system'; }
}

function applyTheme(t = readTheme()) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);

  const meta = THEME_META[t] || THEME_META.system;
  const btn = $('themeBtn');
  if (btn) {
    btn.textContent = meta.icon;
    btn.title = `主题：${meta.label}（点击切换）`;
    btn.setAttribute('aria-label', `主题：${meta.label}`);
  }
  // 移动端浏览器地址栏配色跟随当前主题
  requestAnimationFrame(() => {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim();
    const m = document.querySelector('meta[name="theme-color"]');
    if (c && m) m.setAttribute('content', c);
  });
}

function cycleTheme() {
  const cur = readTheme();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  applyTheme(next);
  showToast(`✓ 主题：${THEME_META[next].label}`);
}

// ---------- «GitHub 设置» 访问密码 ----------
// 密码只以 salt+hash 形式存本机，页面刷新后需重新验证
const PWD_KEY = 'eis_settings_pwd';
let unlocked = false;

function cryptoReady() {
  return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readPwd() {
  try { return JSON.parse(localStorage.getItem(PWD_KEY)); }
  catch { return null; }
}

function hasPassword() {
  const p = readPwd();
  return !!(p && p.salt && p.hash);
}

async function verifyPwd(pwd) {
  const p = readPwd();
  if (!p) return false;
  return (await sha256(p.salt + pwd)) === p.hash;
}

// 点击「GitHub 设置」的统一入口：未设密码 → 先设；已设 → 先验
function requestSettingsAccess() {
  // 非安全上下文（如 file://）没有 Web Crypto，无法安全存储哈希，直接放行
  if (!cryptoReady()) { openSettings(); return; }
  if (!hasPassword()) { openPwdSetup(); return; }
  if (unlocked) { openSettings(); return; }
  openPwdVerify();
}

function resetPwdToggles() {
  document.querySelectorAll('[data-toggle-pwd]').forEach((btn) => {
    const el = $(btn.getAttribute('data-toggle-pwd'));
    if (!el) return;
    el.type = 'password';
    btn.textContent = '显示';
  });
}

function openPwdSetup() {
  $('newPwd').value = '';
  $('confirmPwd').value = '';
  resetPwdToggles();
  openModal('lockSetupModal');
  setTimeout(() => $('newPwd').focus(), 0);
}

async function doPwdSetup() {
  const a = $('newPwd').value;
  const b = $('confirmPwd').value;
  if (a.length < 4) { showToast('密码至少 4 位', 'err'); return; }
  if (a !== b) { showToast('两次输入的密码不一致', 'err'); return; }
  const salt = randomSalt();
  const hash = await sha256(salt + a);
  try { localStorage.setItem(PWD_KEY, JSON.stringify({ salt, hash })); }
  catch { showToast('无法保存密码设置', 'err'); return; }
  unlocked = true;
  closeModal('lockSetupModal');
  showToast('✓ 访问密码已设置');
  openSettings();
}

function openPwdVerify() {
  $('authPwd').value = '';
  $('authErr').hidden = true;
  resetPwdToggles();
  openModal('lockVerifyModal');
  setTimeout(() => $('authPwd').focus(), 0);
}

async function doPwdVerify() {
  const ok = await verifyPwd($('authPwd').value);
  if (!ok) {
    $('authErr').hidden = false;
    $('authPwd').select();
    return;
  }
  unlocked = true;
  closeModal('lockVerifyModal');
  openSettings();
}

// 忘记密码：哈希不可逆，只能重置本机数据
function forgetPassword() {
  try {
    localStorage.removeItem(PWD_KEY);
    localStorage.removeItem(CONFIG_KEY);
  } catch { /* ignore */ }
  clearCache();
  unlocked = false;
  config = null;
  icons = [];
  cacheBust = Date.now();
  closeModals();
  updateRepoLink();
  renderGrid();
  showToast('✓ 本机数据已重置，请重新配置');
}

// ---------- 通用提示 ----------
function showToast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function showLoading(text = '处理中…') {
  $('loadingText').textContent = text;
  $('loading').classList.add('show');
}

function hideLoading() {
  $('loading').classList.remove('show');
}

// ---------- 文件工具 ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取图片'));
    img.src = src;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('无法读取图片'));
    r.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 生成失败'))), 'image/png', 1);
  });
}

// ---------- GitHub API ----------
function ghPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function rawUrl(file) {
  return `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${config.dir}/${encodeURIComponent(file)}`;
}

async function ghRequest(path, options = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
  } catch {
    throw new Error('网络请求失败，请检查网络连接');
  }
  if (res.ok) return res;
  const err = new Error(`GitHub API 错误（${res.status}）`);
  err.status = res.status;
  try { err.detail = (await res.json()).message || ''; } catch { err.detail = ''; }
  throw err;
}

// 统一错误文案（对应 README 第 27 节）
function ghMessage(err, msg404 = '资源不存在') {
  if (err.status === 401) return 'GitHub Token 无效或权限不足';
  if (err.status === 403) {
    return err.detail && /rate limit/i.test(err.detail)
      ? 'GitHub API 请求过于频繁，请稍后再试'
      : 'GitHub API 拒绝访问，请检查 Token 权限';
  }
  if (err.status === 404) return msg404;
  return err.message || '请求失败，请稍后再试';
}

// 校验仓库与分支是否存在
async function checkConnection() {
  try {
    await ghRequest(`/repos/${ghPath(`${config.owner}/${config.repo}`)}`);
  } catch (e) {
    throw new Error(ghMessage(e, '无法访问指定仓库，请检查用户名和仓库名称'));
  }
  try {
    await ghRequest(`/repos/${ghPath(`${config.owner}/${config.repo}`)}/branches/${encodeURIComponent(config.branch)}`);
  } catch (e) {
    throw new Error(ghMessage(e, '指定分支不存在'));
  }
}

// 获取文件 { sha, content(base64) }，不存在返回 null
async function getFile(path) {
  try {
    // 追加时间戳参数穿透缓存：Contents API 在提交后短时间内可能返回旧版本
    const bust = `&_=${Date.now()}`;
    const res = await ghRequest(`/repos/${ghPath(`${config.owner}/${config.repo}`)}/contents/${ghPath(path)}?ref=${encodeURIComponent(config.branch)}${bust}`);
    const data = await res.json();
    return { sha: data.sha, content: data.content ? data.content.replace(/\n/g, '') : '' };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// 写操作冲突重试：提交后立即再读写可能拿到过期 SHA（409），重取再试
async function withRetryOnConflict(fn, attempts = 3) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e.status === 409 && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw e;
    }
  }
}

async function putFile(path, message, contentB64, sha) {
  const body = { message, content: contentB64, branch: config.branch };
  if (sha) body.sha = sha;
  return ghRequest(
    `/repos/${ghPath(`${config.owner}/${config.repo}`)}/contents/${ghPath(path)}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
}

async function deleteGhFile(path, message, sha) {
  return ghRequest(
    `/repos/${ghPath(`${config.owner}/${config.repo}`)}/contents/${ghPath(path)}`,
    { method: 'DELETE', body: JSON.stringify({ message, sha, branch: config.branch }) }
  );
}

// 列出图标目录下所有文件名（目录不存在视为空）
async function listIconDir() {
  try {
    const res = await ghRequest(`/repos/${ghPath(`${config.owner}/${config.repo}`)}/contents/${ghPath(config.dir)}?ref=${encodeURIComponent(config.branch)}`);
    const list = await res.json();
    return Array.isArray(list) ? list.map((i) => i.name) : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

// ---------- icons.json 索引 ----------
function decodeUtf8(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeUtf8(str) {
  // TextEncoder + 分块避免 apply 参数过多导致栈溢出（替代已废弃的 unescape）
  const bytes = new TextEncoder().encode(str);
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function readIndex() {
  const f = await getFile('data/icons.json');
  if (!f || !f.content) return { sha: null, list: [] };
  try {
    const list = JSON.parse(decodeUtf8(f.content));
    return { sha: f.sha, list: Array.isArray(list) ? list : [] };
  } catch {
    return { sha: f.sha, list: [] };
  }
}

async function putJson(path, obj, message, sha) {
  return putFile(path, message, encodeUtf8(JSON.stringify(obj, null, 2) + '\n'), sha);
}

// ---------- 客户端图标库（Emby 客户端订阅用） ----------
// 与主流 Emby 图标库（离歌等）一致的格式，Fileball / Senplayer / Yamby / Hills 可直接订阅
//   { name, description, icons: [{ name, url }] }
const ICONSET_PATH = 'data/iconset.json';

function buildIconset(list) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    name: 'Emby Icon Studio',
    description: `共 ${list.length} 个图标 · 更新于 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    icons: list.map((i) => ({
      name: i.name || String(i.file).replace(/\.png$/, ''),
      url: iconUrl(i)
    }))
  };
}

// 索引变更的统一出口：读 → 变换 → 写回（索引 + 客户端图标库）→ 刷新界面
async function commitIndex(mutate, message) {
  let next;
  await withRetryOnConflict(async () => {
    const idx = await readIndex();
    next = await mutate(idx.list.slice());
    next.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    await putJson('data/icons.json', next, message, idx.sha);
    const set = await getFile(ICONSET_PATH);
    await putJson(ICONSET_PATH, buildIconset(next), message, set && set.sha);
  });
  clearCache();
  cacheBust = Date.now();
  icons = next;
  writeCache(next);
  renderGrid();
  return next;
}

// ---------- 缓存（5 分钟） ----------
function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && Array.isArray(c.list) && Date.now() - c.ts < CACHE_TTL) return c.list;
  } catch { /* ignore */ }
  return null;
}

function writeCache(list) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), list })); }
  catch { /* ignore */ }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

async function loadIcons({ force = false } = {}) {
  if (!isConfigReady()) {
    icons = [];
    renderGrid();
    return;
  }
  if (!force) {
    const cached = readCache();
    if (cached) {
      icons = cached;
      renderGrid();
      return;
    }
  }
  try {
    const { list } = await readIndex();
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    icons = list;
    writeCache(list);
  } catch (e) {
    showToast(ghMessage(e, '读取图标索引失败'), 'err');
  }
  renderGrid();
}

// ---------- 图标展示 / 搜索 / 复制 ----------
function filteredIcons() {
  const q = $('searchInput').value.trim().toLowerCase();
  if (!q) return icons;
  return icons.filter((i) =>
    String(i.name || '').toLowerCase().includes(q) ||
    String(i.file || '').toLowerCase().includes(q)
  );
}

// 图标地址一律按「当前配置」实时拼出，不存绝对 URL
// 这样更换仓库 / 分支 / 目录后，历史图标地址自动跟着生效
function iconUrl(icon) {
  return isConfigReady() ? rawUrl(icon.file) : '';
}

// 追加时间戳绕过 CDN 缓存（地址可能已带查询参数）
function withCacheBust(url) {
  if (!cacheBust) return url;
  return url + (url.includes('?') ? '&' : '?') + `v=${cacheBust}`;
}

function renderGrid() {
  const grid = $('iconGrid');
  grid.innerHTML = '';
  const all = filteredIcons();
  const list = all.slice(0, renderLimit);
  const q = $('searchInput').value.trim();
  const ready = isConfigReady();

  $('emptyState').hidden = list.length > 0 || !ready;
  $('configHint').hidden = ready;

  // 图标计数：搜索时显示「命中 / 总数」
  const countEl = $('iconCount');
  if (ready && icons.length) {
    countEl.hidden = false;
    countEl.textContent = q ? `${all.length} / ${icons.length}` : String(icons.length);
  } else {
    countEl.hidden = true;
  }

  // 搜索无结果（区别于「一个图标都没有」）
  const noHit = ready && icons.length > 0 && q.length > 0 && all.length === 0;
  $('noResult').hidden = !noHit;
  if (noHit) $('noResultKey').textContent = q;

  // 分批渲染：图标多时避免一次性建上千个节点
  const rest = all.length - list.length;
  $('loadMore').hidden = rest <= 0;
  if (rest > 0) $('loadMoreBtn').textContent = `显示更多（还有 ${rest} 个）`;

  for (const icon of list) {
    const url = iconUrl(icon);
    const src = withCacheBust(url);
    const card = document.createElement('div');
    card.className = 'icon-card';
    card.innerHTML = `
      <div class="thumb">
        <img loading="lazy" src="${escapeHtml(src)}" alt="${escapeHtml(icon.name || icon.file)}">
      </div>
      <div class="icon-name" title="${escapeHtml(icon.name || '')}">${escapeHtml(icon.name || icon.file)}</div>
      <div class="icon-actions">
        <button class="btn btn-ghost btn-small" data-act="copy" type="button">复制 URL</button>
        <button class="btn btn-ghost btn-small" data-act="rename" type="button">重命名</button>
      </div>
      <div class="icon-actions">
        <button class="btn btn-danger btn-small" data-act="delete" type="button">删除</button>
      </div>`;
    const img = card.querySelector('img');
    img.addEventListener('error', () => { img.style.opacity = '0.25'; img.title = '图片加载失败'; });
    card.querySelector('[data-act="copy"]').addEventListener('click', () => copyUrl(url));
    card.querySelector('[data-act="rename"]').addEventListener('click', () => askRename(icon));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => askDelete(icon));
    grid.appendChild(card);
  }
}

async function copyUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
    showToast('✓ URL 已复制');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('✓ URL 已复制');
    } catch {
      showToast('复制失败，请手动复制', 'err');
    }
    ta.remove();
  }
}

// 导出全部图标 URL（名称 + Tab + URL，便于直接粘贴到表格）
function exportUrls() {
  if (!icons.length) {
    showToast('还没有图标可导出', 'err');
    return;
  }
  const lines = icons.map((i) => `${i.name || i.file}\t${iconUrl(i)}`);
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `emby-icons-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`✓ 已导出 ${icons.length} 条 URL`);
}

// ---------- 命名：name → slug → filename ----------
// pinyin-pro UMD 全局名为 pinyinPro，pinyin 函数在其属性上
function getPinyinFn() {
  const ns = window.pinyinPro;
  if (ns && typeof ns.pinyin === 'function') return ns.pinyin;
  if (typeof window.pinyin === 'function') return window.pinyin;
  return null;
}

function ensurePinyin() {
  const fn = getPinyinFn();
  if (fn) return Promise.resolve(fn);
  if (!pinyinLoader) {
    pinyinLoader = new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(getPinyinFn()); } };
      const s = document.createElement('script');
      s.src = PINYIN_CDN;
      s.onload = finish;
      s.onerror = () => { done = true; resolve(null); };
      document.head.appendChild(s);
      setTimeout(finish, 5000);
    });
  }
  return pinyinLoader;
}

async function slugify(name) {
  let s = (name || '').trim();
  if (!s) return '';
  if (/[^\u0000-\u007f]/.test(s)) {
    const pinyin = await ensurePinyin();
    if (pinyin) {
      try { s = pinyin(s, { toneType: 'none', type: 'string', separator: '' }); }
      catch { /* 保留原文 */ }
    }
  }
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function makeUniqueName(name, existingFiles) {
  const base = (await slugify(name)) || 'icon';
  const taken = new Set(existingFiles.map((n) => n.toLowerCase()));
  let file = `${base}.png`;
  let i = 2;
  while (taken.has(file.toLowerCase())) {
    file = `${base}-${i}.png`;
    i++;
  }
  return file;
}

// ---------- 图标编辑器 ----------
function viewportSize() {
  return $('cropStage').clientWidth || 360;
}

// 显示比例：默认 100% 时图片恰好铺满裁剪区域
function editorScale() {
  const vp = viewportSize();
  return Math.max(vp / editor.w, vp / editor.h) * (editor.zoom / 100);
}

function clampPos() {
  const vp = viewportSize();
  const s = editorScale();
  const dx = Math.max(0, (editor.w * s - vp) / 2);
  const dy = Math.max(0, (editor.h * s - vp) / 2);
  editor.x = Math.min(dx, Math.max(-dx, editor.x));
  editor.y = Math.min(dy, Math.max(-dy, editor.y));
}

function applyEditor() {
  if (!editor) return;
  clampPos();
  const img = $('cropImg');
  const s = editorScale();
  img.style.width = `${editor.w * s}px`;
  img.style.height = `${editor.h * s}px`;
  img.style.transform = `translate(calc(-50% + ${editor.x}px), calc(-50% + ${editor.y}px))`;
  img.style.opacity = editor.opacity / 100;
  $('cropArea').style.borderRadius = editor.shape === 'circle' ? '50%' : '0';
  drawPreview();
}

// 视口坐标系 → 输出画布（512×512 或预览）
function renderTo(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const vp = viewportSize();
  const k = canvas.width / vp;
  const s = editorScale() * k;
  ctx.save();
  ctx.beginPath();
  if (editor.shape === 'circle') {
    ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
  } else {
    ctx.rect(0, 0, canvas.width, canvas.height);
  }
  ctx.clip();
  ctx.globalAlpha = editor.opacity / 100;
  ctx.drawImage(
    editor.img,
    canvas.width / 2 + editor.x * k - (editor.w * s) / 2,
    canvas.height / 2 + editor.y * k - (editor.h * s) / 2,
    editor.w * s,
    editor.h * s
  );
  ctx.restore();
}

function drawPreview() {
  if (editor) renderTo($('previewCanvas'));
}

async function openEditor(file) {
  if (!ACCEPT_TYPES.has(file.type)) {
    showToast('仅支持 PNG / JPG / JPEG / WEBP / GIF 图片', 'err');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showToast('图片不能超过 10MB', 'err');
    return;
  }
  let url;
  try {
    url = URL.createObjectURL(file);
    const img = await loadImage(url);
    if (currentFile) URL.revokeObjectURL(currentFile);
    currentFile = url;
    editor = {
      img, w: img.naturalWidth, h: img.naturalHeight,
      x: 0, y: 0, zoom: 100, opacity: 80, shape: 'circle'
    };
  } catch (e) {
    if (url) URL.revokeObjectURL(url);
    showToast(e.message, 'err');
    return;
  }

  $('cropImg').src = currentFile;
  $('iconName').value = (file.name || '').replace(/\.[^.]+$/, '');
  $('shapeCircle').checked = true;
  $('opacityRange').value = 80;
  $('opacityVal').textContent = '80%';
  $('zoomRange').value = 100;
  $('zoomVal').textContent = '100%';
  openModal('editorModal');
  requestAnimationFrame(applyEditor);
}

function closeEditor() {
  closeModals();
  if (currentFile) {
    URL.revokeObjectURL(currentFile);
    currentFile = null;
  }
  editor = null;
  const img = $('cropImg');
  img.removeAttribute('src');
  img.style.width = '0';
  img.style.height = '0';
}

function setZoom(z) {
  editor.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z)));
  $('zoomRange').value = editor.zoom;
  $('zoomVal').textContent = `${editor.zoom}%`;
  applyEditor();
}

function resetEditor() {
  if (!editor) return;
  editor.x = 0;
  editor.y = 0;
  editor.zoom = 100;
  editor.opacity = 80;
  editor.shape = 'circle';
  $('shapeCircle').checked = true;
  $('opacityRange').value = 80;
  $('opacityVal').textContent = '80%';
  $('zoomRange').value = 100;
  $('zoomVal').textContent = '100%';
  applyEditor();
}

// ---------- 生成 PNG 并保存到 GitHub ----------
async function saveIcon() {
  if (!editor) return;
  if (!requireConfig()) return;
  const name = $('iconName').value.trim();
  try {
    showLoading('正在生成 PNG…');
    const canvas = document.createElement('canvas');
    canvas.width = OUT_SIZE;
    canvas.height = OUT_SIZE;
    renderTo(canvas);
    const blob = await canvasToBlob(canvas);
    const content = await blobToBase64(blob);

    showLoading('正在上传到 GitHub…');
    await checkConnection();
    const existing = await listIconDir();
    const file = await makeUniqueName(name, existing);

    // 1. 上传 PNG（已存在则覆盖）
    await withRetryOnConflict(async () => {
      const existed = await getFile(`${config.dir}/${file}`);
      await putFile(`${config.dir}/${file}`, `feat: add icon ${file}`, content, existed && existed.sha);
    });

    // 2. 更新索引与客户端图标库，并以本地结果刷新界面
    //    （Contents API 提交后存在短暂缓存，回读可能拿到旧数据）
    await commitIndex((list) => {
      list.push({ name: name || file.replace(/\.png$/, ''), file });
      return list;
    }, `feat: add icon ${file}`);

    closeEditor();
    showToast('✓ 已上传到 GitHub');
  } catch (e) {
    showToast(ghMessage(e, '保存失败'), 'err');
  } finally {
    hideLoading();
  }
}

// ---------- 通用确认弹窗 ----------
function askConfirm(text, onOk) {
  $('confirmText').textContent = text;
  confirmHandler = onOk;
  openModal('confirmModal');
}

// ---------- 删除图标 ----------
function askDelete(icon) {
  askConfirm(`确定删除「${icon.name || icon.file}」？同时会删除仓库中对应的 PNG 文件。`,
    () => doDelete(icon));
}

async function doDelete(icon) {
  if (!requireConfig()) return;
  try {
    showLoading('正在删除图标…');
    await withRetryOnConflict(async () => {
      const f = await getFile(`${config.dir}/${icon.file}`);
      if (f) await deleteGhFile(`${config.dir}/${icon.file}`, `feat: remove icon ${icon.file}`, f.sha);
    });
    await commitIndex(
      (list) => list.filter((i) => i.file !== icon.file),
      `feat: remove icon ${icon.file}`
    );
    showToast('✓ 已删除');
  } catch (e) {
    showToast(ghMessage(e, '删除失败'), 'err');
  } finally {
    hideLoading();
  }
}

// ---------- 重命名图标 ----------
function askRename(icon) {
  pendingRename = icon;
  $('renameInput').value = icon.name || String(icon.file).replace(/\.png$/, '');
  openModal('renameModal');
  setTimeout(() => $('renameInput').select(), 0);
}

async function doRename() {
  if (!pendingRename) return;
  const icon = pendingRename;
  const name = $('renameInput').value.trim();
  if (!name) {
    showToast('名称不能为空', 'err');
    return;
  }
  if (name === (icon.name || '')) {
    pendingRename = null;
    closeModal('renameModal');
    return;
  }
  pendingRename = null;
  closeModals();
  if (!requireConfig()) return;
  try {
    showLoading('正在重命名…');
    await commitIndex((list) => list.map((i) => ({
      name: i.file === icon.file ? name : (i.name || i.file),
      file: i.file
    })), `chore: rename icon ${icon.file}`);
    showToast('✓ 已重命名');
  } catch (e) {
    showToast(ghMessage(e, '重命名失败'), 'err');
  } finally {
    hideLoading();
  }
}

// ---------- 导出与客户端导入 ----------
let lastIconsetUrl = '';

function openClient() {
  if (!requireConfig()) return;
  // 与主流 Emby 图标库一致：直接用 raw 地址，客户端订阅最稳
  lastIconsetUrl = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${ICONSET_PATH}`;
  $('iconsetUrl').value = lastIconsetUrl;
  const enc = encodeURIComponent(lastIconsetUrl);
  const here = location.origin + location.pathname.replace(/index\.html$/, '');
  $('senplayerLink').href = `${here}import.html?to=senplayer&iconset=${enc}`;
  $('rodelLink').href = `${here}import.html?to=rodel&iconset=${enc}`;
  openModal('clientModal');
}

// ---------- 配置迁移：加密导出 / 导入 ----------
// 换个设备就要重填一遍配置（尤其是一长串 Token），所以做成加密导出：
// PBKDF2 派生密钥 + AES-GCM 加密，密文由用户自己保管，页面不存、不上传
const TRANSFER_PREFIX = 'EIS1';
const PBKDF2_ROUNDS = 200000;

function b64enc(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64dec(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function deriveKey(pwd, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptConfig(obj, pwd) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pwd, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))
  );
  return [TRANSFER_PREFIX, b64enc(salt), b64enc(iv), b64enc(ct)].join('.');
}

async function decryptConfig(text, pwd) {
  const parts = String(text || '').trim().split('.');
  if (parts.length !== 4 || parts[0] !== TRANSFER_PREFIX) throw new Error('格式不对');
  const key = await deriveKey(pwd, b64dec(parts[1]));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(parts[2]) }, key, b64dec(parts[3]));
  return JSON.parse(new TextDecoder().decode(pt));
}

let transferMode = 'export';

function setTransferMode(mode) {
  transferMode = mode;
  $('transferIn').hidden = mode !== 'import';
  $('transferOut').hidden = mode !== 'export';
  $('transferPrimary').textContent = mode === 'export' ? '生成导出内容' : '解密并导入';
  $('tabExport').classList.toggle('btn-primary', mode === 'export');
  $('tabExport').classList.toggle('btn-ghost', mode !== 'export');
  $('tabImport').classList.toggle('btn-primary', mode === 'import');
  $('tabImport').classList.toggle('btn-ghost', mode !== 'import');
  $('transferHint').textContent = mode === 'export'
    ? '把 GitHub 配置（含 Token）用密码加密后导出一串文本。换设备时导入它并输入同一个密码即可，不必重新填写。'
    : '粘贴之前导出的内容，输入同一个密码，即可在这台设备上恢复配置。';
}

function openTransfer(mode = 'export') {
  if (!cryptoReady()) { showToast('当前环境不支持加密，无法迁移配置', 'err'); return; }
  if (mode === 'export' && !isConfigReady()) { showToast('请先完成 GitHub 配置', 'err'); return; }
  $('transferText').value = '';
  $('transferResult').value = '';
  resetPwdToggles();
  setTransferMode(mode);
  openModal('transferModal');
}

async function exportConfig() {
  const pwd = $('transferPwd').value;
  if (pwd.length < 4) { showToast('请设置至少 4 位的保护密码', 'err'); return; }
  try {
    $('transferResult').value = await encryptConfig(config, pwd);
    showToast('✓ 已生成，复制或下载保存好');
  } catch (e) {
    showToast('加密失败：' + (e.message || ''), 'err');
  }
}

async function importConfig() {
  const text = $('transferText').value.trim();
  const pwd = $('transferPwd').value;
  if (!text) { showToast('请粘贴导出内容', 'err'); return; }
  if (!pwd) { showToast('请输入保护密码', 'err'); return; }

  let c;
  try {
    c = await decryptConfig(text, pwd);
  } catch {
    showToast('解密失败：内容或密码不正确', 'err');
    return;
  }
  if (!c || !c.owner || !c.repo || !c.token) {
    showToast('内容不完整，缺少用户名 / 仓库 / Token', 'err');
    return;
  }

  const next = {
    owner: c.owner,
    repo: c.repo,
    branch: c.branch || 'main',
    dir: c.dir || 'icons',
    token: c.token
  };
  const prev = config;
  config = next;
  try {
    showLoading('正在校验配置…');
    await checkConnection();
    hideLoading();
  } catch (e) {
    config = prev;
    hideLoading();
    showToast('已解密，但仓库校验未通过：' + ghMessage(e, '连接失败'), 'err');
    return;
  }

  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  closeModal('transferModal');
  clearCache();
  cacheBust = Date.now();
  unlocked = false;   // 新设备重新设一次访问密码
  updateRepoLink();
  loadIcons({ force: true });
  showToast('✓ 配置已导入');
}

function downloadTransfer() {
  const text = $('transferResult').value.trim();
  if (!text) { showToast('请先点「生成导出内容」', 'err'); return; }
  const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'emby-icon-studio-config.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 设置弹窗 ----------
function openSettings() {
  const c = config || {};
  $('cfgOwner').value = c.owner || '';
  $('cfgRepo').value = c.repo || '';
  $('cfgBranch').value = c.branch || 'main';
  $('cfgDir').value = c.dir || 'icons';
  $('cfgToken').value = c.token || '';
  resetPwdToggles();
  openModal('settingsModal');
}

async function saveSettings() {
  const c = {
    owner: $('cfgOwner').value.trim(),
    repo: $('cfgRepo').value.trim(),
    branch: $('cfgBranch').value.trim() || 'main',
    dir: $('cfgDir').value.trim() || 'icons',
    token: $('cfgToken').value.trim()
  };
  if (!c.owner || !c.repo || !c.token) {
    showToast('请填写用户名、仓库和 Token', 'err');
    return;
  }

  const prev = config;
  config = c;
  try {
    showLoading('正在校验仓库…');
    await checkConnection();
    hideLoading();
  } catch (e) {
    hideLoading();
    // 仓库/分支写错或 Token 无效 → 拦下来，避免存一份用不了的配置
    // 网络或限流等临时性问题 → 放行，但明确告知
    if (e.status === 401 || e.status === 403 || e.status === 404) {
      config = prev;
      updateRepoLink();
      showToast(ghMessage(e, '配置校验失败'), 'err');
      return;
    }
    showToast('已保存，但仓库校验未通过：' + ghMessage(e, '连接失败'), 'err');
  }

  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  closeModal('settingsModal');
  clearCache();
  cacheBust = Date.now();
  updateRepoLink();
  loadIcons({ force: true });
  if (!$('toast').classList.contains('show')) showToast('✓ 配置已保存');
}

function clearSettings() {
  try { localStorage.removeItem(CONFIG_KEY); } catch { /* ignore */ }
  clearCache();
  config = null;
  icons = [];
  cacheBust = Date.now();
  closeModals();
  updateRepoLink();
  renderGrid();
  showToast('✓ 本机配置已清除');
}

// ---------- 弹窗通用 ----------
function openModal(id) {
  $(id).classList.add('show');
}

function closeModal(id) {
  $(id).classList.remove('show');
}

function closeModals() {
  document.querySelectorAll('.modal.show').forEach((m) => m.classList.remove('show'));
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 上传
  $('uploadBtn').addEventListener('click', () => $('fileInput').click());
  $('dropZone').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) openEditor(f);
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    $('dropZone').addEventListener(ev, (e) => {
      e.preventDefault();
      $('dropZone').classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    $('dropZone').addEventListener(ev, (e) => {
      e.preventDefault();
      $('dropZone').classList.remove('drag');
    })
  );
  $('dropZone').addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openEditor(f);
  });

  // 编辑器：拖动
  const stage = $('cropStage');
  let dragging = false;
  let last = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!editor) return;
    dragging = true;
    last = [e.clientX, e.clientY];
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging || !editor) return;
    editor.x += e.clientX - last[0];
    editor.y += e.clientY - last[1];
    last = [e.clientX, e.clientY];
    applyEditor();
  });
  ['pointerup', 'pointercancel'].forEach((ev) =>
    stage.addEventListener(ev, () => { dragging = false; })
  );

  // 编辑器：滚轮缩放
  stage.addEventListener('wheel', (e) => {
    if (!editor) return;
    e.preventDefault();
    setZoom(editor.zoom + (e.deltaY < 0 ? 5 : -5));
  }, { passive: false });

  // 编辑器：控件
  $('zoomRange').addEventListener('input', (e) => {
    if (!editor) return;
    editor.zoom = +e.target.value;
    $('zoomVal').textContent = `${editor.zoom}%`;
    applyEditor();
  });
  $('opacityRange').addEventListener('input', (e) => {
    if (!editor) return;
    editor.opacity = +e.target.value;
    $('opacityVal').textContent = `${editor.opacity}%`;
    applyEditor();
  });
  $('shapeCircle').addEventListener('change', () => {
    if (editor) { editor.shape = 'circle'; applyEditor(); }
  });
  $('shapeSquare').addEventListener('change', () => {
    if (editor) { editor.shape = 'square'; applyEditor(); }
  });
  $('resetBtn').addEventListener('click', resetEditor);
  $('generateBtn').addEventListener('click', saveIcon);
  $('editorClose').addEventListener('click', closeEditor);

  // 设置（受访问密码保护）
  $('settingsBtn').addEventListener('click', requestSettingsAccess);
  $('saveSettings').addEventListener('click', () => { saveSettings(); });
  $('cancelSettings').addEventListener('click', () => closeModal('settingsModal'));
  $('clearSettings').addEventListener('click', clearSettings);

  // 密码显隐：所有 data-toggle-pwd 按钮共用一套逻辑
  document.querySelectorAll('[data-toggle-pwd]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const el = $(btn.getAttribute('data-toggle-pwd'));
      if (!el) return;
      const toText = el.type === 'password';
      el.type = toText ? 'text' : 'password';
      btn.textContent = toText ? '隐藏' : '显示';
    })
  );

  // 访问密码：设置 / 验证 / 忘记
  $('confirmPwdSetup').addEventListener('click', () => { doPwdSetup(); });
  $('cancelPwdSetup').addEventListener('click', () => closeModal('lockSetupModal'));
  $('newPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('confirmPwd').focus(); });
  $('confirmPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') doPwdSetup(); });

  $('confirmAuth').addEventListener('click', () => { doPwdVerify(); });
  $('cancelAuth').addEventListener('click', () => closeModal('lockVerifyModal'));
  $('authPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') doPwdVerify(); });
  $('authPwd').addEventListener('input', () => { $('authErr').hidden = true; });
  $('forgetPwd').addEventListener('click', () => {
    closeModal('lockVerifyModal');
    askConfirm('密码无法找回，重置将清除本机的访问密码与 GitHub 配置（仓库中的图标不受影响）。确定继续？', forgetPassword);
  });

  // 主题
  $('themeBtn').addEventListener('click', cycleTheme);

  // 确认弹窗
  $('confirmDelete').addEventListener('click', () => {
    const fn = confirmHandler;
    confirmHandler = null;
    closeModals();
    if (fn) fn();
  });
  $('cancelDelete').addEventListener('click', () => {
    confirmHandler = null;
    closeModal('confirmModal');
  });

  // 重命名确认
  $('confirmRename').addEventListener('click', doRename);
  $('cancelRename').addEventListener('click', () => {
    pendingRename = null;
    closeModal('renameModal');
  });
  $('renameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doRename();
  });

  // 刷新 / 导入 / 客户端
  $('refreshBtn').addEventListener('click', async () => {
    if (!requireConfig()) return;
    cacheBust = Date.now();
    renderLimit = 120;
    await loadIcons({ force: true });
    showToast('✓ 已刷新');
  });
  $('clientBtn').addEventListener('click', openClient);

  // 配置迁移（加密导出 / 导入）
  $('exportConfigBtn').addEventListener('click', () => openTransfer('export'));
  $('hintImportBtn').addEventListener('click', () => openTransfer('import'));
  $('hintSettingsBtn').addEventListener('click', requestSettingsAccess);
  $('tabExport').addEventListener('click', () => setTransferMode('export'));
  $('tabImport').addEventListener('click', () => setTransferMode('import'));
  $('transferPrimary').addEventListener('click', () => {
    if (transferMode === 'export') exportConfig();
    else importConfig();
  });
  $('copyTransfer').addEventListener('click', () => copyUrl($('transferResult').value));
  $('downloadTransfer').addEventListener('click', downloadTransfer);

  // 客户端弹窗
  $('copyIconset').addEventListener('click', () => copyUrl(lastIconsetUrl));
  $('exportTxtBtn').addEventListener('click', () => {
    if (!requireConfig()) return;
    exportUrls();
  });

  // 分批渲染
  $('loadMoreBtn').addEventListener('click', () => {
    renderLimit += 120;
    renderGrid();
  });

  // 搜索（防抖，图标多时避免每次按键都重建整个网格）
  let searchTimer = null;
  $('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      renderLimit = 120;
      renderGrid();
    }, 140);
  });

  // data-close 按钮 / 点击遮罩 / Esc 关闭
  document.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      if (id === 'editorModal') closeEditor();
      else closeModal(id);
    })
  );
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => {
      if (e.target !== m) return;
      if (m.id === 'editorModal') closeEditor();
      else m.classList.remove('show');
    })
  );
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.modal.show');
    if (!open) return;
    if (open.id === 'editorModal') closeEditor();
    else open.classList.remove('show');
  });

  // 窗口尺寸变化时重算编辑器
  window.addEventListener('resize', () => {
    if (editor && $('editorModal').classList.contains('show')) applyEditor();
  });
}

// ---------- 初始化 ----------
function init() {
  applyTheme();
  updateRepoLink();
  bindEvents();
  loadIcons();

  // 跟随系统时，系统主题切换后同步状态栏配色
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readTheme() === 'system') applyTheme('system');
    });
  }
}

init();
