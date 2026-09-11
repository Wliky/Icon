'use strict';

/* =====================================================
 * Icon · Emby 图标库
 * 纯前端：GitHub Pages + GitHub REST API
 *
 * 客户端需要一个公开的 JSON 地址来订阅图标；本项目是静态站、无后端，
 * 所以直接拿 GitHub 仓库当存储 + raw / jsDelivr 当图床。
 * 仓库信息能从当前网址自动识别，因此用户只需要填一个 Token。
 * ===================================================== */

// ---------- 常量 ----------
const CONFIG_KEY = 'icon_github_config';
const CONFIG_KEY_LEGACY = 'eis_github_config';
const CACHE_KEY = 'icon_icons_cache';
const PWD_KEY = 'icon_settings_pwd';
const THEME_KEY = 'icon_theme';
const BG_KEY = 'icon_bg';
const CACHE_TTL = 5 * 60 * 1000;
const INDEX_PATH = 'data/icons.json';
const ICONSET_PATH = 'data/iconset.json';
const DEFAULT_DIR = 'icons';
const DEFAULT_BRANCH = 'main';
const DEFAULT_OWNER = 'Wliky';
const DEFAULT_REPO = 'Icon';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PINYIN_CDN = 'https://cdn.jsdelivr.net/npm/pinyin-pro@3/dist/index.min.js';
const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const LIB_NAME = 'Icon';
const RENDER_STEP = 120;
const CROP_DEFAULT = 108;

// ---------- 状态 ----------
let config = migrateConfig() || readConfig();
let icons = [];
let cdnKind = 'jsdelivr';
let unlocked = false;
let cacheBust = 0;
let renderLimit = RENDER_STEP;
let pendingRename = null;
let confirmHandler = null;
let previewIcon = null;
let pinyinLoader = null;
let jszipLoader = null;
let selectMode = false;
let selected = new Set();
let crop = null;

// ---------- 小工具 ----------
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function showToast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show${type === 'err' ? ' err' : ''}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function showLoading(text = '处理中…') {
  $('loadingText').textContent = text;
  $('loading').classList.add('show');
}
function hideLoading() { $('loading').classList.remove('show'); }

// ---------- 配置 ----------
function readConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null; }
  catch { return null; }
}

function migrateConfig() {
  let old = null;
  try { old = JSON.parse(localStorage.getItem(CONFIG_KEY_LEGACY)); } catch { /* ignore */ }
  if (!old || !old.owner || !old.repo || !old.token) return null;
  const next = {
    owner: old.owner, repo: old.repo,
    branch: old.branch || DEFAULT_BRANCH,
    dir: old.dir || DEFAULT_DIR,
    token: old.token
  };
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    localStorage.removeItem(CONFIG_KEY_LEGACY);
  } catch { /* ignore */ }
  return next;
}

function isConfigReady(c = config) {
  return !!(c && c.owner && c.repo && c.branch && c.dir && c.token);
}

// 从当前网址识别仓库：xxx.github.io/Repo/ → owner=xxx, repo=Repo
function inferRepo() {
  const host = location.hostname || '';
  const seg = location.pathname.split('/').filter(Boolean);
  if (/\.github\.io$/i.test(host)) {
    return {
      owner: host.replace(/\.github\.io$/i, ''),
      repo: seg[0] || DEFAULT_REPO,
      branch: DEFAULT_BRANCH, dir: DEFAULT_DIR, auto: true
    };
  }
  return { owner: '', repo: '', branch: DEFAULT_BRANCH, dir: DEFAULT_DIR, auto: false };
}

function repoSlug() {
  const inf = inferRepo();
  const owner = (config && config.owner) || inf.owner || DEFAULT_OWNER;
  const repo = (config && config.repo) || inf.repo || DEFAULT_REPO;
  return `${owner}/${repo}`;
}

function updateRepoLink() {
  const slug = repoSlug();
  const url = `https://github.com/${slug}`;
  $('repoLink').href = url;
  $('repoLabel').textContent = slug;
  $('ghBtn').href = url;
  $('ghBtn').title = `打开 GitHub 仓库：${url}`;
}

// ---------- 主题：跟随系统 / 浅色 / 深色 ----------
const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_ICON = { system: '#i-auto', light: '#i-sun', dark: '#i-moon' };
const THEME_NAME = { system: '跟随系统', light: '浅色', dark: '深色' };

function readTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (THEME_ORDER.includes(t)) return t; }
  catch { /* ignore */ }
  return 'system';
}

function applyTheme(t = readTheme()) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  $('themeBtn').querySelector('use').setAttribute('href', THEME_ICON[t]);
  $('themeBtn').title = `主题：${THEME_NAME[t]}`;
  document.querySelectorAll('#themeMenu button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.theme === t));
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0e1014' : '#f5f6f8');
}

function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  applyTheme(t);
  closeThemeMenu();
  showToast(`✓ 主题：${THEME_NAME[t]}`);
}

function toggleThemeMenu(force) {
  const m = $('themeMenu');
  const open = typeof force === 'boolean' ? force : m.hidden;
  m.hidden = !open;
  $('themeBtn').setAttribute('aria-expanded', String(open));
}
function closeThemeMenu() { toggleThemeMenu(false); }

// ---------- 页面背景 ----------
function readBg() {
  try { return JSON.parse(localStorage.getItem(BG_KEY)) || { url: '', dim: 60 }; }
  catch { return { url: '', dim: 60 }; }
}

function applyBg(bg = readBg()) {
  const url = String((bg && bg.url) || '').trim();
  const dim = Math.min(90, Math.max(0, Number(bg && bg.dim) || 0));
  $('bgLayer').style.backgroundImage = url ? `url("${url.replace(/["'\\]/g, '')}")` : 'none';
  $('bgDim').style.opacity = url ? String(dim / 100) : '1';
  document.body.classList.toggle('has-bg', !!url);
}

function saveBg(bg) {
  try { localStorage.setItem(BG_KEY, JSON.stringify(bg)); } catch { /* ignore */ }
  applyBg(bg);
}

// ---------- 设置访问密码 ----------
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
  try { return JSON.parse(localStorage.getItem(PWD_KEY)); } catch { return null; }
}
function hasPassword() {
  const p = readPwd();
  return !!(p && p.salt && p.hash);
}
async function verifyPwd(pwd) {
  const p = readPwd();
  return p ? (await sha256(p.salt + pwd)) === p.hash : false;
}

function requestSettingsAccess() {
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
  if (!(await verifyPwd($('authPwd').value))) {
    $('authErr').hidden = false;
    $('authPwd').select();
    return;
  }
  unlocked = true;
  closeModal('lockVerifyModal');
  openSettings();
}

function forgetPassword() {
  try {
    localStorage.removeItem(PWD_KEY);
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(CONFIG_KEY_LEGACY);
  } catch { /* ignore */ }
  clearCache();
  unlocked = false;
  config = null;
  icons = [];
  cacheBust = Date.now();
  closeModals();
  updateRepoLink();
  renderAll();
  showToast('✓ 本机数据已重置，请重新配置');
}

// ---------- GitHub API ----------
function ghPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
function repoApi() { return `/repos/${ghPath(`${config.owner}/${config.repo}`)}`; }

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

function ghMessage(err, msg404 = '资源不存在') {
  if (err.status === 401) return 'GitHub Token 无效或已过期';
  if (err.status === 403) {
    return err.detail && /rate limit/i.test(err.detail)
      ? 'GitHub API 请求过于频繁，请稍后再试'
      : 'GitHub API 拒绝访问，请检查 Token 权限';
  }
  if (err.status === 404) return msg404;
  return err.message || '请求失败，请稍后再试';
}

async function withRetryOnConflict(fn, attempts = 3) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (e.status === 409 && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw e;
    }
  }
}

async function getFile(path) {
  try {
    const bust = `&_=${Date.now()}`;
    const res = await ghRequest(`${repoApi()}/contents/${ghPath(path)}?ref=${encodeURIComponent(config.branch)}${bust}`);
    const data = await res.json();
    return { sha: data.sha, content: data.content ? data.content.replace(/\n/g, '') : '' };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function putFile(path, message, contentB64, sha) {
  const body = { message, content: contentB64, branch: config.branch };
  if (sha) body.sha = sha;
  return ghRequest(`${repoApi()}/contents/${ghPath(path)}`, { method: 'PUT', body: JSON.stringify(body) });
}

async function deleteGhFile(path, message, sha) {
  return ghRequest(`${repoApi()}/contents/${ghPath(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: config.branch })
  });
}

async function listIconDir() {
  try {
    const res = await ghRequest(`${repoApi()}/contents/${ghPath(config.dir)}?ref=${encodeURIComponent(config.branch)}`);
    const list = await res.json();
    return Array.isArray(list) ? list.map((i) => i.name) : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

// ---------- 编码 / 索引 ----------
function decodeUtf8(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function readIndex() {
  const f = await getFile(INDEX_PATH);
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

function buildIconset(list) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    name: LIB_NAME,
    description: `共 ${list.length} 个图标 · 更新于 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    icons: list.map((i) => ({
      name: i.name || String(i.file).replace(/\.[^.]+$/, ''),
      url: iconUrl(i)
    }))
  };
}

function sortList(list) {
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
}

async function commitIndex(mutate, message) {
  let next;
  await withRetryOnConflict(async () => {
    const idx = await readIndex();
    next = sortList(await mutate(idx.list.slice()));
    await putJson(INDEX_PATH, next, message, idx.sha);
    const set = await getFile(ICONSET_PATH);
    await putJson(ICONSET_PATH, buildIconset(next), message, set && set.sha);
  });
  clearCache();
  cacheBust = Date.now();
  icons = next;
  writeCache(next);
  renderAll();
  return next;
}

// ---------- 缓存 ----------
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
  if (!isConfigReady()) { icons = []; renderAll(); return; }
  if (!force) {
    const cached = readCache();
    if (cached) { icons = cached; renderAll(); return; }
  }
  try {
    const { list } = await readIndex();
    icons = sortList(list);
    pruneSelection();
    writeCache(icons);
  } catch (e) {
    showToast(ghMessage(e, '读取图标索引失败'), 'err');
  }
  renderAll();
}

// ---------- 地址 ----------
function iconUrl(icon) {
  return isConfigReady() ? rawUrl(icon.file) : '';
}

function withCacheBust(url) {
  if (!cacheBust) return url;
  return url + (url.includes('?') ? '&' : '?') + `v=${cacheBust}`;
}

function iconsetUrl() {
  if (!isConfigReady()) return '';
  const { owner, repo, branch } = config;
  return cdnKind === 'jsdelivr'
    ? `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${ICONSET_PATH}`
    : `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${ICONSET_PATH}`;
}

function renderSub() {
  const ready = isConfigReady();
  $('subCount').textContent = `${icons.length} 个图标`;
  $('subUrl').value = ready ? iconsetUrl() : '';
  $('copySubBtn').disabled = !ready;
  document.querySelectorAll('#cdnSeg .seg-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.cdn === cdnKind);
  });
  $('subNote').textContent = ready
    ? (cdnKind === 'jsdelivr'
      ? 'jsDelivr 在国内更稳；新上传的图标最多延迟几分钟同步。想立刻生效可切到 GitHub Raw。'
      : 'GitHub Raw 即时生效，但国内网络可能打不开；客户端访问不畅时改用 jsDelivr。')
    : '完成 GitHub 配置后自动生成。';
  $('guide').hidden = ready;
}

// ---------- 渲染 ----------
function filteredIcons() {
  const q = $('searchInput').value.trim().toLowerCase();
  if (!q) return icons;
  return icons.filter(
    (i) => String(i.name || '').toLowerCase().includes(q) || String(i.file || '').toLowerCase().includes(q)
  );
}

function tileHtml(icon) {
  const name = escapeHtml(icon.name || icon.file);
  const sel = selected.has(icon.file);
  return `<article class="tile${sel ? ' sel' : ''}" data-file="${escapeHtml(icon.file)}">
    <button type="button" class="tile-check" data-act="pick" aria-label="选择" aria-pressed="${sel}"><svg class="ico"><use href="#i-check"/></svg></button>
    <div class="tile-img" data-act="preview" title="点击预览">
      <img src="${escapeHtml(withCacheBust(iconUrl(icon)))}" alt="${name}" loading="lazy" decoding="async">
    </div>
    <div class="tile-body">
      <span class="tile-name" title="${name}">${name}</span>
      <span class="tile-act">
        <button type="button" data-act="crop" title="裁剪"><svg class="ico"><use href="#i-crop"/></svg></button>
        <button type="button" data-act="rename" title="重命名"><svg class="ico"><use href="#i-settings"/></svg></button>
        <button type="button" class="del" data-act="delete" title="删除"><svg class="ico"><use href="#i-trash"/></svg></button>
      </span>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $('iconGrid');
  const list = filteredIcons();
  const q = $('searchInput').value.trim();

  renderLimit = Math.max(RENDER_STEP, renderLimit);
  const slice = list.slice(0, renderLimit);
  grid.innerHTML = slice.map(tileHtml).join('');
  grid.classList.toggle('picking', selectMode);

  $('empty').hidden = icons.length > 0 || !isConfigReady();
  $('noResult').hidden = !(icons.length > 0 && list.length === 0);
  $('noResultKey').textContent = q;
  $('loadMore').hidden = list.length <= slice.length;

  grid.querySelectorAll('img').forEach((img) => {
    img.onerror = () => {
      img.replaceWith(Object.assign(document.createElement('span'), { textContent: '⚠️', title: '图片加载失败' }));
    };
  });
}

function renderBulkBar() {
  const n = selected.size;
  $('bulkBar').hidden = !(selectMode || n > 0);
  $('bulkCount').textContent = `已选 ${n} 个`;
  $('bulkDownload').disabled = n === 0;
  $('bulkDelete').disabled = n === 0;
  $('selectBtn').classList.toggle('on', selectMode);
}

function renderAll() {
  renderSub();
  renderGrid();
  renderBulkBar();
  updateRepoLink();
}

function pruneSelection() {
  const valid = new Set(icons.map((i) => i.file));
  [...selected].forEach((f) => { if (!valid.has(f)) selected.delete(f); });
}

function setSelectMode(on) {
  selectMode = on;
  if (!on) selected.clear();
  renderAll();
}

// ---------- 复制 ----------
async function copyText(text, okMsg = '✓ 已复制') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    showToast(ok ? okMsg : '复制失败，请手动选择复制', ok ? 'ok' : 'err');
  }
}

// ---------- 命名 ----------
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
      try { s = pinyin(s, { toneType: 'none', type: 'string', separator: '' }); } catch { /* 保留原文 */ }
    }
  }
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function makeUniqueName(name, existingFiles, ext) {
  const base = (await slugify(name)) || 'icon';
  const taken = new Set(existingFiles.map((n) => n.toLowerCase()));
  let file = `${base}.${ext}`;
  let i = 2;
  while (taken.has(file.toLowerCase())) {
    file = `${base}-${i}.${ext}`;
    i++;
  }
  return file;
}

// ---------- 上传（原样保存，支持批量） ----------
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('无法读取图片'));
    r.readAsDataURL(blob);
  });
}

function pickFiles(list) {
  const all = [...list];
  const imgs = all.filter((f) => f.type.startsWith('image/'));
  const skipped = all.length - imgs.length;
  if (skipped > 0) showToast(`已跳过 ${skipped} 个非图片文件`, 'err');
  const ok = [];
  imgs.forEach((f) => {
    if (f.size > MAX_FILE_SIZE) showToast(`「${f.name}」超过 10MB，已跳过`, 'err');
    else ok.push(f);
  });
  return ok;
}

async function uploadFiles(fileList) {
  if (!isConfigReady()) { showToast('请先完成 GitHub 配置', 'err'); requestSettingsAccess(); return; }
  const files = pickFiles(fileList);
  if (!files.length) return;

  showLoading(`上传 1/${files.length}`);
  try {
    const existing = await listIconDir();
    const added = [];
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      showLoading(`上传 ${i + 1}/${files.length}`);
      try {
        const ext = (f.name.split('.').pop() || 'png').toLowerCase();
        const base = f.name.replace(/\.[^.]+$/, '') || 'icon';
        const file = await makeUniqueName(base, existing, ext);
        existing.push(file);
        const b64 = await blobToBase64(f);
        await putFile(`${config.dir}/${file}`, `feat: add icon ${file}`, b64);
        added.push({ name: base, file });
      } catch (e) {
        failed.push(f.name);
      }
    }
    if (added.length) {
      await commitIndex(async (list) => list.concat(added), `feat: add ${added.length} icon(s)`);
    }
    if (failed.length) showToast(`${added.length ? `✓ 已上传 ${added.length} 个，` : ''}${failed.length} 个失败`, failed.length && !added.length ? 'err' : 'ok');
    else showToast(`✓ 已上传 ${added.length} 个图标`);
  } catch (e) {
    showToast(ghMessage(e, '上传失败'), 'err');
  } finally {
    hideLoading();
  }
}

// ---------- 批量下载 ----------
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function loadJsZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipLoader) {
    jszipLoader = new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(window.JSZip || null); } };
      const s = document.createElement('script');
      s.src = JSZIP_CDN;
      s.onload = finish;
      s.onerror = () => { done = true; resolve(null); };
      document.head.appendChild(s);
      setTimeout(finish, 8000);
    });
  }
  return jszipLoader;
}

async function downloadZip(list) {
  if (!list.length) return;
  showLoading('准备打包…');
  let JSZip = null;
  try { JSZip = await loadJsZip(); } catch { /* ignore */ }

  // 拿不到 JSZip 就降级：逐个触发下载
  if (!JSZip) {
    hideLoading();
    showToast('打包组件加载失败，改为逐个下载', 'err');
    for (let i = 0; i < list.length; i++) {
      const a = document.createElement('a');
      a.href = withCacheBust(iconUrl(list[i]));
      a.download = list[i].file;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 350));
    }
    return;
  }

  const zip = new JSZip();
  let ok = 0;
  for (let i = 0; i < list.length; i++) {
    showLoading(`打包 ${i + 1}/${list.length}`);
    try {
      const res = await fetch(withCacheBust(iconUrl(list[i])));
      if (!res.ok) throw new Error(String(res.status));
      zip.file(list[i].file, await res.arrayBuffer());
      ok++;
    } catch { /* 跳过失败项 */ }
  }
  hideLoading();
  if (!ok) { showToast('打包失败，图片全部无法下载', 'err'); return; }
  const blob = await zip.generateAsync({ type: 'blob' });
  saveBlob(blob, `icons-${ok}.zip`);
  showToast(`✓ 已打包 ${ok} 个图标`);
}

function downloadSelected() {
  const list = icons.filter((i) => selected.has(i.file));
  downloadZip(list);
}

// ---------- 裁剪编辑器 ----------
function loadImage(src, cross) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cross) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

async function openCrop(icon) {
  if (!isConfigReady()) { showToast('请先完成 GitHub 配置', 'err'); return; }
  showLoading('加载图片…');
  let img;
  try {
    img = await loadImage(withCacheBust(iconUrl(icon)), true);
  } catch {
    hideLoading();
    showToast('图片加载失败，无法裁剪', 'err');
    return;
  }
  hideLoading();

  crop = {
    icon, img,
    zoom: 1, x: 0, y: 0,
    size: CROP_DEFAULT, shape: 'square',
    natW: img.naturalWidth, natH: img.naturalHeight
  };

  $('cropImg').src = img.src;
  $('cropZoom').value = '100';
  $('cropZoomVal').textContent = '100%';
  document.querySelectorAll('#sizeSeg .seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.size === String(CROP_DEFAULT)));
  document.querySelectorAll('#shapeSeg .seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.shape === 'square'));

  openModal('editorModal');
  requestAnimationFrame(() => applyCrop());
}

function stageSize() {
  return $('cropStage').clientWidth || 320;
}

function applyCrop() {
  if (!crop) return;
  const S = stageSize();
  const base = Math.max(S / crop.natW, S / crop.natH);   // cover：图片始终铺满裁剪框
  const scale = base * crop.zoom;
  const maxX = Math.max(0, (crop.natW * scale - S) / 2);
  const maxY = Math.max(0, (crop.natH * scale - S) / 2);
  crop.x = Math.min(maxX, Math.max(-maxX, crop.x));
  crop.y = Math.min(maxY, Math.max(-maxY, crop.y));

  const el = $('cropImg');
  el.style.width = `${crop.natW}px`;
  el.style.height = `${crop.natH}px`;
  el.style.transform =
    `translate(${S / 2 + crop.x - (crop.natW * scale) / 2}px, ${S / 2 + crop.y - (crop.natH * scale) / 2}px) scale(${scale})`;

  $('cropStage').classList.toggle('round', crop.shape === 'circle');
  $('cropZoomVal').textContent = `${Math.round(crop.zoom * 100)}%`;
}

function setCropZoom(z) {
  if (!crop) return;
  crop.zoom = Math.min(4, Math.max(1, z));
  $('cropZoom').value = String(Math.round(crop.zoom * 100));
  applyCrop();
}

function resetCrop() {
  if (!crop) return;
  crop.zoom = 1; crop.x = 0; crop.y = 0;
  $('cropZoom').value = '100';
  applyCrop();
}

function cropCanvas() {
  const S = stageSize();
  const { img, zoom, x, y, size, shape, natW, natH } = crop;
  const base = Math.max(S / natW, S / natH);
  const scale = base * zoom;
  const left = S / 2 + x - (natW * scale) / 2;
  const top = S / 2 + y - (natH * scale) / 2;
  const sx = -left / scale;
  const sy = -top / scale;
  const sw = S / scale;

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  }
  ctx.drawImage(img, sx, sy, sw, sw, 0, 0, size, size);
  return c;
}

async function saveCrop() {
  if (!crop) return;
  const { icon, size } = crop;
  showLoading('生成并上传…');
  try {
    const blob = await new Promise((r) => cropCanvas().toBlob(r, 'image/png'));
    if (!blob) throw new Error('生成失败');
    const b64 = await blobToBase64(blob);

    const oldPath = `${config.dir}/${icon.file}`;
    const isPng = /\.png$/i.test(icon.file);

    if (isPng) {
      const f = await getFile(oldPath);
      await putFile(oldPath, `feat: crop icon ${icon.file} to ${size}`, b64, f && f.sha);
    } else {
      // 裁剪输出的是 PNG：换扩展名存一份新的，再删掉旧文件
      const base = icon.file.replace(/\.[^.]+$/, '');
      const newFile = await makeUniqueName(base, await listIconDir(), 'png');
      await putFile(`${config.dir}/${newFile}`, `feat: crop icon ${icon.file} to ${size}`, b64);
      const old = await getFile(oldPath);
      if (old) await deleteGhFile(oldPath, `feat: remove original ${icon.file}`, old.sha);
      await commitIndex(
        async (list) => list.map((i) => (i.file === icon.file ? { ...i, file: newFile } : i)),
        `feat: replace ${icon.file} with cropped ${newFile}`
      );
    }

    cacheBust = Date.now();
    clearCache();
    closeModal('editorModal');
    await loadIcons({ force: true });
    showToast(`✓ 已裁剪为 ${size}×${size} 并保存`);
  } catch (e) {
    showToast(ghMessage(e, '裁剪保存失败'), 'err');
  } finally {
    hideLoading();
  }
}

// ---------- 批量删除 ----------
function askDeleteSelected() {
  const list = icons.filter((i) => selected.has(i.file));
  if (!list.length) return;
  $('confirmTitle').textContent = '批量删除图标';
  $('confirmText').textContent =
    `确定删除选中的 ${list.length} 个图标吗？仓库里的图片文件会一起删除，且无法撤销。`;
  confirmHandler = () => deleteSelected(list);
  openModal('confirmModal');
}

async function deleteSelected(list) {
  closeModal('confirmModal');
  showLoading(`删除 1/${list.length}`);
  const removed = new Set();
  const failed = [];
  try {
    for (let i = 0; i < list.length; i++) {
      showLoading(`删除 ${i + 1}/${list.length}`);
      const icon = list[i];
      try {
        const f = await getFile(`${config.dir}/${icon.file}`);
        if (f) await deleteGhFile(`${config.dir}/${icon.file}`, `feat: remove icon ${icon.file}`, f.sha);
        removed.add(icon.file);
      } catch {
        failed.push(icon.name || icon.file);
      }
    }
    // 索引只提交一次：删 N 个图标也只写一遍 icons.json
    if (removed.size) {
      await commitIndex(
        async (l) => l.filter((i) => !removed.has(i.file)),
        `feat: remove ${removed.size} icon(s)`
      );
    }
    selected.clear();
    renderAll();
    if (failed.length) {
      showToast(
        `${removed.size ? `✓ 已删除 ${removed.size} 个，` : ''}${failed.length} 个失败`,
        removed.size ? 'ok' : 'err'
      );
    } else {
      showToast(`✓ 已删除 ${removed.size} 个图标`);
    }
  } catch (e) {
    showToast(ghMessage(e, '删除失败'), 'err');
    renderAll();
  } finally {
    hideLoading();
  }
}

// ---------- 删除 / 重命名 ----------
function askDelete(icon) {
  $('confirmTitle').textContent = '删除图标';
  $('confirmText').textContent = `确定删除「${icon.name || icon.file}」吗？仓库里的图片文件会一起删除，且无法撤销。`;
  confirmHandler = () => doDelete(icon);
  openModal('confirmModal');
}

async function doDelete(icon) {
  closeModal('confirmModal');
  showLoading('删除中…');
  try {
    const f = await getFile(`${config.dir}/${icon.file}`);
    if (f) await deleteGhFile(`${config.dir}/${icon.file}`, `feat: remove icon ${icon.file}`, f.sha);
    await commitIndex(
      async (list) => list.filter((i) => i.file !== icon.file),
      `feat: remove icon ${icon.file}`
    );
    showToast('✓ 已删除');
  } catch (e) {
    showToast(ghMessage(e, '删除失败'), 'err');
  } finally {
    hideLoading();
  }
}

function askRename(icon) {
  pendingRename = icon;
  $('renameInput').value = icon.name || '';
  openModal('renameModal');
  setTimeout(() => { $('renameInput').focus(); $('renameInput').select(); }, 0);
}

async function doRename() {
  const icon = pendingRename;
  if (!icon) return;
  const name = $('renameInput').value.trim();
  if (!name) { showToast('名称不能为空', 'err'); return; }
  closeModal('renameModal');
  showLoading('保存中…');
  try {
    await commitIndex(
      async (list) => list.map((i) => (i.file === icon.file ? { ...i, name } : i)),
      `feat: rename icon ${icon.file}`
    );
    pendingRename = null;
    showToast('✓ 已重命名');
  } catch (e) {
    showToast(ghMessage(e, '保存失败'), 'err');
  } finally {
    hideLoading();
  }
}

function openPreview(icon) {
  previewIcon = icon;
  $('previewName').textContent = icon.name || icon.file;
  $('previewFile').textContent = icon.file;
  $('previewImg').src = withCacheBust(iconUrl(icon));
  openModal('previewModal');
}

// ---------- 弹窗 ----------
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
function closeModals() {
  document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
}

// ---------- 设置 ----------
function openSettings() {
  const inf = inferRepo();
  const c = config || {};
  $('cfgToken').value = c.token || '';
  $('cfgOwner').value = c.owner || inf.owner;
  $('cfgRepo').value = c.repo || inf.repo;
  $('cfgBranch').value = c.branch || inf.branch;
  $('cfgDir').value = c.dir || inf.dir;

  const auto = inf.auto && !!inf.repo;
  $('inferRepo').textContent = auto ? `${inf.owner}/${inf.repo}` : '无法自动识别';
  $('inferBranch').textContent = inf.branch;
  $('inferDir').textContent = inf.dir + '/';
  $('inferHint').textContent = auto
    ? '以上信息从当前网址自动识别，一般不需要改。'
    : '当前是自定义域名或本地调试，无法自动识别，请在「高级」里手动填写。';
  $('advBox').open = !auto;

  const bg = readBg();
  $('cfgBgUrl').value = bg.url || '';
  $('cfgBgDim').value = String(bg.dim ?? 60);
  $('cfgBgDimVal').textContent = `${bg.dim ?? 60}%`;

  resetPwdToggles();
  openModal('settingsModal');
  setTimeout(() => $('cfgToken').focus(), 0);
}

function readBgForm() {
  return {
    url: $('cfgBgUrl').value.trim(),
    dim: Number($('cfgBgDim').value) || 0
  };
}

async function saveSettings() {
  const token = $('cfgToken').value.trim();
  const owner = $('cfgOwner').value.trim();
  const repo = $('cfgRepo').value.trim();
  const branch = $('cfgBranch').value.trim() || DEFAULT_BRANCH;
  const dir = ($('cfgDir').value.trim() || DEFAULT_DIR).replace(/^\/+|\/+$/g, '');

  // 背景独立于 GitHub 配置，先存
  saveBg(readBgForm());

  if (!token) { showToast('请填写 GitHub Token', 'err'); return; }
  if (!owner || !repo) { showToast('请填写仓库的用户名和名称', 'err'); return; }

  const prev = config;
  config = { owner, repo, branch, dir, token };
  showLoading('正在连接仓库…');
  try {
    const res = await ghRequest(repoApi());
    const info = await res.json();
    if (info && info.default_branch && !$('cfgBranch').value.trim()) config.branch = info.default_branch;
    await ghRequest(`${repoApi()}/branches/${encodeURIComponent(config.branch)}`);
  } catch (e) {
    config = prev;
    showToast(ghMessage(e, '仓库或分支不存在，请检查'), 'err');
    return;
  } finally {
    hideLoading();
  }

  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
  catch { showToast('无法保存配置', 'err'); return; }

  unlocked = true;
  closeModal('settingsModal');
  updateRepoLink();
  showToast('✓ 连接成功');
  await loadIcons({ force: true });
}

function clearSettings() {
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(CONFIG_KEY_LEGACY);
  } catch { /* ignore */ }
  clearCache();
  config = null;
  icons = [];
  unlocked = false;
  selected.clear();
  selectMode = false;
  closeModals();
  renderAll();
  showToast('✓ 已清除本机配置');
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 主题菜单
  $('themeBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleThemeMenu(); });
  $('themeMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-theme]');
    if (b) setTheme(b.dataset.theme);
  });
  document.addEventListener('click', (e) => {
    if (!$('themeMenu').hidden && !e.target.closest('.menu-wrap')) closeThemeMenu();
  });

  $('refreshBtn').addEventListener('click', async () => {
    if (!isConfigReady()) { showToast('请先完成 GitHub 配置', 'err'); requestSettingsAccess(); return; }
    const ico = $('refreshIco');
    ico.classList.add('spin');
    await loadIcons({ force: true });
    ico.classList.remove('spin');
    showToast('✓ 已刷新');
  });

  $('settingsBtn').addEventListener('click', requestSettingsAccess);
  $('guideSetupBtn').addEventListener('click', requestSettingsAccess);

  // CDN 切换
  $('cdnSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    cdnKind = btn.dataset.cdn;
    renderSub();
  });
  $('copySubBtn').addEventListener('click', () => {
    const url = $('subUrl').value;
    if (!url) { showToast('请先完成 GitHub 配置', 'err'); return; }
    copyText(url, '✓ 订阅地址已复制');
  });

  // 搜索
  let searchTimer = null;
  $('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { renderLimit = RENDER_STEP; renderGrid(); }, 140);
  });

  // 上传
  $('fileInput').addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    e.target.value = '';
  });
  $('dropzone').addEventListener('click', () => $('fileInput').click());

  // 全页拖放
  const dz = $('dropzone');
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  ['dragenter', 'dragover'].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dz.classList.add('over');
    })
  );
  document.addEventListener('dragleave', (e) => { if (hasFiles(e)) dz.classList.remove('over'); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dz.classList.remove('over');
    uploadFiles(e.dataTransfer.files);
  });

  // 批量选择
  $('selectBtn').addEventListener('click', () => setSelectMode(!selectMode));
  $('bulkAll').addEventListener('click', () => {
    filteredIcons().forEach((i) => selected.add(i.file));
    renderAll();
  });
  $('bulkNone').addEventListener('click', () => { selected.clear(); renderAll(); });
  $('bulkDownload').addEventListener('click', downloadSelected);
  $('bulkDelete').addEventListener('click', askDeleteSelected);

  // 网格操作
  $('iconGrid').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const icon = icons.find((i) => i.file === tile.dataset.file);
    if (!icon) return;
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'pick') {
      if (!selectMode) setSelectMode(true);
      if (selected.has(icon.file)) selected.delete(icon.file);
      else selected.add(icon.file);
      renderAll();
    } else if (a === 'preview') openPreview(icon);
    else if (a === 'crop') openCrop(icon);
    else if (a === 'rename') askRename(icon);
    else if (a === 'delete') askDelete(icon);
  });

  $('loadMore').addEventListener('click', () => {
    renderLimit += RENDER_STEP;
    renderGrid();
  });

  // 设置弹窗
  $('saveSettingsBtn').addEventListener('click', saveSettings);
  $('clearSettingsBtn').addEventListener('click', clearSettings);

  // 背景
  let bgTimer = null;
  const bgLive = () => {
    clearTimeout(bgTimer);
    bgTimer = setTimeout(() => {
      const bg = readBgForm();
      $('cfgBgDimVal').textContent = `${bg.dim}%`;
      saveBg(bg);
    }, 300);
  };
  $('cfgBgUrl').addEventListener('input', bgLive);
  $('cfgBgDim').addEventListener('input', () => {
    $('cfgBgDimVal').textContent = `${$('cfgBgDim').value}%`;
    bgLive();
  });
  $('bgApplyBtn').addEventListener('click', () => {
    saveBg(readBgForm());
    showToast('✓ 背景已应用');
  });
  $('bgClearBtn').addEventListener('click', () => {
    $('cfgBgUrl').value = '';
    saveBg({ url: '', dim: 60 });
    showToast('✓ 已清除背景');
  });

  // 密码弹窗
  $('pwdSetupOk').addEventListener('click', doPwdSetup);
  $('authOk').addEventListener('click', doPwdVerify);
  $('forgetPwdBtn').addEventListener('click', forgetPassword);
  $('authPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') doPwdVerify(); });
  $('newPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('confirmPwd').focus(); });
  $('confirmPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') doPwdSetup(); });

  // 重命名
  $('renameOk').addEventListener('click', doRename);
  $('renameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); });

  // 确认弹窗
  $('confirmOk').addEventListener('click', () => { if (confirmHandler) confirmHandler(); });

  // 预览
  $('previewCopy').addEventListener('click', () => {
    if (previewIcon) copyText(iconUrl(previewIcon), '✓ 图片地址已复制');
  });

  // 裁剪编辑器
  let drag = null;
  const stage = $('cropStage');
  stage.addEventListener('pointerdown', (e) => {
    if (!crop) return;
    stage.setPointerCapture(e.pointerId);
    drag = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || !crop) return;
    crop.x = drag.x + (e.clientX - drag.px);
    crop.y = drag.y + (e.clientY - drag.py);
    applyCrop();
  });
  ['pointerup', 'pointercancel'].forEach((ev) =>
    stage.addEventListener(ev, () => { drag = null; })
  );
  stage.addEventListener('wheel', (e) => {
    if (!crop) return;
    e.preventDefault();
    setCropZoom(crop.zoom * (e.deltaY > 0 ? 0.94 : 1.06));
  }, { passive: false });
  $('cropZoom').addEventListener('input', () => setCropZoom(Number($('cropZoom').value) / 100));
  $('cropReset').addEventListener('click', resetCrop);
  $('cropSave').addEventListener('click', saveCrop);
  $('sizeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b || !crop) return;
    crop.size = Number(b.dataset.size);
    document.querySelectorAll('#sizeSeg .seg-btn').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('shapeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b || !crop) return;
    crop.shape = b.dataset.shape;
    document.querySelectorAll('#shapeSeg .seg-btn').forEach((x) => x.classList.toggle('on', x === b));
    applyCrop();
  });

  // 通用：关闭按钮 / 点遮罩关闭 / Esc
  document.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', () => closeModal(el.closest('.modal').id))
  );
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); })
  );
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  // 密码显示切换
  document.querySelectorAll('[data-toggle-pwd]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const el = $(btn.getAttribute('data-toggle-pwd'));
      const show = el.type === 'password';
      el.type = show ? 'text' : 'password';
      btn.textContent = show ? '隐藏' : '显示';
    })
  );
}

// ---------- 初始化 ----------
function init() {
  applyTheme();
  applyBg();
  bindEvents();
  updateRepoLink();
  renderAll();
  if (isConfigReady()) loadIcons();
}

document.addEventListener('DOMContentLoaded', init);
