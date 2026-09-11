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
let pendingDelete = null;
let pendingRename = null;
let cacheBust = 0;        // 上传/删除后刷新缩略图缓存
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

async function writeIndex(list, sha) {
  const json = JSON.stringify(list, null, 2) + '\n';
  return putFile('data/icons.json', 'chore: update icons.json', encodeUtf8(json), sha);
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

// 地址按「当前配置」实时拼出，不再依赖索引里存的绝对 url
// 这样更换仓库 / 分支 / 目录后，历史图标地址自动跟着生效
function iconUrl(icon) {
  if (isConfigReady()) return rawUrl(icon.file);
  return icon.url || '';
}

function renderGrid() {
  const grid = $('iconGrid');
  grid.innerHTML = '';
  const list = filteredIcons();
  const q = $('searchInput').value.trim();
  const ready = isConfigReady();

  $('emptyState').hidden = list.length > 0 || !ready;
  $('configHint').hidden = ready;

  // 图标计数：搜索时显示「命中 / 总数」
  const countEl = $('iconCount');
  if (ready && icons.length) {
    countEl.hidden = false;
    countEl.textContent = q ? `${list.length} / ${icons.length}` : String(icons.length);
  } else {
    countEl.hidden = true;
  }

  // 搜索无结果（区别于「一个图标都没有」）
  const noHit = ready && icons.length > 0 && q.length > 0 && list.length === 0;
  $('noResult').hidden = !noHit;
  if (noHit) $('noResultKey').textContent = q;

  for (const icon of list) {
    const url = iconUrl(icon);
    const src = url + (cacheBust ? `?v=${cacheBust}` : '');
    const card = document.createElement('div');
    card.className = 'icon-card';
    card.innerHTML = `
      <div class="thumb"><img loading="lazy" src="${escapeHtml(src)}" alt="${escapeHtml(icon.name || icon.file)}"></div>
      <div class="icon-name" title="${escapeHtml(icon.name || '')}">${escapeHtml(icon.name || icon.file)}</div>
      <div class="icon-actions">
        <button class="btn btn-ghost btn-small" data-act="copy" type="button">复制 URL</button>
        <button class="btn btn-ghost btn-small" data-act="rename" type="button">重命名</button>
      </div>
      <div class="icon-actions">
        <button class="btn btn-danger btn-small" data-act="delete" type="button">删除</button>
      </div>`;
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

    // 2. 更新 icons.json 索引
    let list;
    await withRetryOnConflict(async () => {
      const idx = await readIndex();
      list = idx.list;
      // 不再写入绝对 url：地址由当前配置实时拼出，换仓库/分支后不会失效
      list.push({ name: name || file.replace(/\.png$/, ''), file });
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
      await writeIndex(list, idx.sha);
    });

    // 3. 以本地写入结果为准刷新界面（Contents API 提交后存在短暂缓存，回读可能拿到旧数据）
    clearCache();
    cacheBust = Date.now();
    icons = list;
    writeCache(list);
    closeEditor();
    renderGrid();
    showToast('✓ 已保存到 GitHub');
  } catch (e) {
    showToast(ghMessage(e, '保存失败'), 'err');
  } finally {
    hideLoading();
  }
}

// ---------- 删除图标 ----------
function askDelete(icon) {
  pendingDelete = icon;
  $('confirmText').textContent = `确定删除「${icon.name || icon.file}」？`;
  openModal('confirmModal');
}

async function doDelete() {
  if (!pendingDelete) return;
  const icon = pendingDelete;
  pendingDelete = null;
  closeModals();
  if (!requireConfig()) return;
  try {
    showLoading('正在删除图标…');
    // 1. 获取 PNG 的 SHA 并删除
    await withRetryOnConflict(async () => {
      const f = await getFile(`${config.dir}/${icon.file}`);
      if (f) {
        await deleteGhFile(`${config.dir}/${icon.file}`, `feat: remove icon ${icon.file}`, f.sha);
      }
    });
    // 2. 更新 icons.json，并以本地结果刷新界面（规避 Contents API 提交后的短暂缓存）
    let next;
    await withRetryOnConflict(async () => {
      const idx = await readIndex();
      next = idx.list.filter((i) => i.file !== icon.file);
      await writeIndex(next, idx.sha);
    });

    clearCache();
    cacheBust = Date.now();
    icons = next;
    writeCache(next);
    renderGrid();
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
    let next;
    await withRetryOnConflict(async () => {
      const idx = await readIndex();
      // 归一化条目：只保留 name / file，顺带清掉历史遗留的 url 字段
      next = idx.list
        .map((i) => ({ name: i.file === icon.file ? name : (i.name || i.file), file: i.file }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
      await writeIndex(next, idx.sha);
    });
    clearCache();
    icons = next;
    writeCache(next);
    renderGrid();
    showToast('✓ 已重命名');
  } catch (e) {
    showToast(ghMessage(e, '重命名失败'), 'err');
  } finally {
    hideLoading();
  }
}

// ---------- 设置弹窗 ----------
function openSettings() {
  const c = config || {};
  $('cfgOwner').value = c.owner || '';
  $('cfgRepo').value = c.repo || '';
  $('cfgBranch').value = c.branch || 'main';
  $('cfgDir').value = c.dir || 'icons';
  $('cfgToken').value = c.token || '';
  $('cfgToken').type = 'password';
  $('toggleToken').textContent = '显示';
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

  // 设置
  $('settingsBtn').addEventListener('click', openSettings);
  $('saveSettings').addEventListener('click', () => { saveSettings(); });
  $('cancelSettings').addEventListener('click', () => closeModal('settingsModal'));
  $('clearSettings').addEventListener('click', clearSettings);
  $('toggleToken').addEventListener('click', () => {
    const el = $('cfgToken');
    const toText = el.type === 'password';
    el.type = toText ? 'text' : 'password';
    $('toggleToken').textContent = toText ? '隐藏' : '显示';
  });

  // 删除确认
  $('confirmDelete').addEventListener('click', doDelete);
  $('cancelDelete').addEventListener('click', () => {
    pendingDelete = null;
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

  // 刷新 / 导出
  $('refreshBtn').addEventListener('click', async () => {
    if (!requireConfig()) return;
    cacheBust = Date.now();
    await loadIcons({ force: true });
    showToast('✓ 已刷新');
  });
  $('exportBtn').addEventListener('click', () => {
    if (!requireConfig()) return;
    exportUrls();
  });

  // 搜索
  $('searchInput').addEventListener('input', renderGrid);

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
  updateRepoLink();
  bindEvents();
  loadIcons();
}

init();
