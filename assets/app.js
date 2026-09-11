'use strict';

/* =====================================================
 * Icon · Emby 图标库
 * 纯前端：GitHub Pages + GitHub REST API
 * 浏览器 → localStorage → GitHub API
 *
 * 设计前提：
 *   Emby 三方客户端需要「一个公开可访问的 JSON 地址」来订阅图标，
 *   本项目自身就是静态站、没有后端，所以直接拿 GitHub 仓库当存储 +
 *   raw / jsDelivr 当图床。仓库信息能从当前网址自动识别，
 *   因此用户只需要填一个 Token。
 * ===================================================== */

// ---------- 常量 ----------
const CONFIG_KEY = 'icon_github_config';
const CONFIG_KEY_LEGACY = 'eis_github_config';   // 旧版本配置，读一次后迁移
const CACHE_KEY = 'icon_icons_cache';
const PWD_KEY = 'icon_settings_pwd';
const THEME_KEY = 'icon_theme';
const CACHE_TTL = 5 * 60 * 1000;
const INDEX_PATH = 'data/icons.json';
const ICONSET_PATH = 'data/iconset.json';
const DEFAULT_DIR = 'icons';
const DEFAULT_BRANCH = 'main';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PINYIN_CDN = 'https://cdn.jsdelivr.net/npm/pinyin-pro@3/dist/index.min.js';
const LIB_NAME = 'Icon';
const RENDER_STEP = 120;

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
  showToast._t = setTimeout(() => t.classList.remove('show'), 2200);
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

// 旧版本（Emby-Icon-Studio）配置迁移到新 key，避免老用户重填
function migrateConfig() {
  let old = null;
  try { old = JSON.parse(localStorage.getItem(CONFIG_KEY_LEGACY)); } catch { /* ignore */ }
  if (!old || !old.owner || !old.repo || !old.token) return null;
  const next = {
    owner: old.owner,
    repo: old.repo,
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
      repo: seg[0] || '',
      branch: DEFAULT_BRANCH,
      dir: DEFAULT_DIR,
      auto: true
    };
  }
  // 自定义域名 / 本地调试：识别不了，交给用户手填
  return { owner: '', repo: '', branch: DEFAULT_BRANCH, dir: DEFAULT_DIR, auto: false };
}

function updateRepoLink() {
  const a = $('repoLink');
  if (isConfigReady()) {
    a.hidden = false;
    a.href = `https://github.com/${config.owner}/${config.repo}`;
    a.textContent = `${config.owner}/${config.repo}`;
  } else {
    a.hidden = true;
  }
}

// ---------- 主题 ----------
const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_ICON = { system: '🌓', light: '☀️', dark: '🌙' };

function readTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (THEME_ORDER.includes(t)) return t; }
  catch { /* ignore */ }
  return 'system';
}

function applyTheme(t = readTheme()) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  $('themeBtn').textContent = THEME_ICON[t];
  $('themeBtn').title = `主题：${{ system: '跟随系统', light: '浅色', dark: '深色' }[t]}（点击切换）`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0e1014' : '#f5f6f8');
}

function cycleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(readTheme()) + 1) % THEME_ORDER.length];
  try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  applyTheme(next);
  showToast(`✓ 主题：${{ system: '跟随系统', light: '浅色', dark: '深色' }[next]}`);
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

// 写操作冲突重试：提交后立刻再读可能拿到过期 SHA（409）
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

// ---------- 客户端订阅用的图标库 JSON ----------
// 主流 Emby 三方客户端通用格式：{ name, description, icons: [{ name, url }] }
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

// 索引变更统一出口：读 → 变换 → 写回（索引 + 订阅 JSON）→ 刷新界面
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
  if (!isConfigReady()) {
    icons = [];
    renderAll();
    return;
  }
  if (!force) {
    const cached = readCache();
    if (cached) { icons = cached; renderAll(); return; }
  }
  try {
    const { list } = await readIndex();
    icons = sortList(list);
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

// 订阅地址：jsDelivr 走国内 CDN，GitHub Raw 最即时
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

function renderGrid() {
  const grid = $('iconGrid');
  const list = filteredIcons();
  const q = $('searchInput').value.trim();

  renderLimit = Math.max(RENDER_STEP, renderLimit);
  const slice = list.slice(0, renderLimit);
  grid.innerHTML = slice.map((icon) => {
    const name = escapeHtml(icon.name || icon.file);
    return `<article class="tile" data-file="${escapeHtml(icon.file)}">
      <div class="tile-img" data-act="preview" title="点击预览">
        <img src="${escapeHtml(withCacheBust(iconUrl(icon)))}" alt="${name}" loading="lazy" decoding="async">
      </div>
      <div class="tile-body">
        <span class="tile-name" title="${name}">${name}</span>
        <span class="tile-act">
          <button type="button" data-act="copy" title="复制图片地址">🔗</button>
          <button type="button" data-act="rename" title="重命名">✏️</button>
          <button type="button" class="del" data-act="delete" title="删除">🗑</button>
        </span>
      </div>
    </article>`;
  }).join('');

  $('empty').hidden = icons.length > 0 || !isConfigReady();
  $('noResult').hidden = !(icons.length > 0 && list.length === 0);
  $('noResultKey').textContent = q;
  $('loadMore').hidden = list.length <= slice.length;

  // 图片加载失败（文件被删 / 地址失效）时给个提示，不留白块
  grid.querySelectorAll('img').forEach((img) => {
    img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: '⚠️', title: '图片加载失败' })); };
  });
}

function renderAll() {
  renderSub();
  renderGrid();
  updateRepoLink();
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

// ---------- 命名：中文名 → 拼音文件名 ----------
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

// ---------- 上传（原样保存） ----------
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('无法读取图片'));
    r.readAsDataURL(blob);
  });
}

function pickFiles(list) {
  const files = [...list].filter((f) => f.type.startsWith('image/'));
  const skipped = [...list].length - files.length;
  if (skipped > 0) showToast(`已跳过 ${skipped} 个非图片文件`, 'err');
  return files.filter((f) => {
    if (f.size > MAX_FILE_SIZE) { showToast(`「${f.name}」超过 10MB，已跳过`, 'err'); return false; }
    return true;
  });
}

async function uploadFiles(fileList) {
  if (!isConfigReady()) { showToast('请先完成 GitHub 配置', 'err'); requestSettingsAccess(); return; }
  const files = pickFiles(fileList);
  if (!files.length) return;

  showLoading(`上传 1/${files.length}`);
  try {
    const existing = await listIconDir();
    const added = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      showLoading(`上传 ${i + 1}/${files.length}`);
      const ext = (f.name.split('.').pop() || 'png').toLowerCase();
      const base = f.name.replace(/\.[^.]+$/, '') || 'icon';
      const file = await makeUniqueName(base, existing, ext);
      existing.push(file);
      const b64 = await blobToBase64(f);
      await putFile(`${config.dir}/${file}`, `feat: add icon ${file}`, b64);
      added.push({ name: base, file });
    }
    await commitIndex(async (list) => list.concat(added), `feat: add ${added.length} icon(s)`);
    showToast(`✓ 已上传 ${added.length} 个图标`);
  } catch (e) {
    showToast(ghMessage(e, '上传失败'), 'err');
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

// ---------- 预览 ----------
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

  resetPwdToggles();
  openModal('settingsModal');
  setTimeout(() => $('cfgToken').focus(), 0);
}

async function saveSettings() {
  const token = $('cfgToken').value.trim();
  const owner = $('cfgOwner').value.trim();
  const repo = $('cfgRepo').value.trim();
  const branch = $('cfgBranch').value.trim() || DEFAULT_BRANCH;
  const dir = ($('cfgDir').value.trim() || DEFAULT_DIR).replace(/^\/+|\/+$/g, '');

  if (!token) { showToast('请填写 GitHub Token', 'err'); return; }
  if (!owner || !repo) { showToast('请填写仓库的用户名和名称', 'err'); return; }

  const prev = config;
  config = { owner, repo, branch, dir, token };
  showLoading('正在连接仓库…');
  try {
    const res = await ghRequest(repoApi());
    const info = await res.json();
    // 用仓库默认分支兜底，避免 main / master 猜错
    if (info && info.default_branch && !$('cfgBranch').value.trim()) {
      config.branch = info.default_branch;
    }
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
  closeModals();
  updateRepoLink();
  renderAll();
  showToast('✓ 已清除本机配置');
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $('themeBtn').addEventListener('click', cycleTheme);
  $('refreshBtn').addEventListener('click', async () => {
    if (!isConfigReady()) { showToast('请先完成 GitHub 配置', 'err'); requestSettingsAccess(); return; }
    await loadIcons({ force: true });
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

  // 搜索（防抖）
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
  ['dragleave'].forEach((ev) =>
    document.addEventListener(ev, (e) => { if (!hasFiles(e)) return; dz.classList.remove('over'); })
  );
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dz.classList.remove('over');
    uploadFiles(e.dataTransfer.files);
  });

  // 网格操作
  $('iconGrid').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const icon = icons.find((i) => i.file === tile.dataset.file);
    if (!icon) return;
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'preview') openPreview(icon);
    else if (act.dataset.act === 'copy') copyText(iconUrl(icon), '✓ 图片地址已复制');
    else if (act.dataset.act === 'rename') askRename(icon);
    else if (act.dataset.act === 'delete') askDelete(icon);
  });

  $('loadMore').addEventListener('click', () => {
    renderLimit += RENDER_STEP;
    renderGrid();
  });

  // 设置弹窗
  $('saveSettingsBtn').addEventListener('click', saveSettings);
  $('clearSettingsBtn').addEventListener('click', clearSettings);

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

  // 通用：关闭按钮 / 点遮罩关闭 / Esc
  document.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', () => closeModal(el.closest('.modal').id))
  );
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); })
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModals();
  });

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
  bindEvents();
  updateRepoLink();
  renderAll();
  if (isConfigReady()) loadIcons();
}

document.addEventListener('DOMContentLoaded', init);
