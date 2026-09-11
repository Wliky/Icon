<div align="center">

# 🎬 Emby Icon Studio

**纯前端的 Emby 图标制作与管理工具**

跑在 GitHub Pages 上，用你自己的 GitHub 仓库当图床。
无后端 · 无数据库 · 无需服务器 · 没有 npm 依赖

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-在线可用-22c55e?logo=githubpages&logoColor=white)](https://wliky.github.io/Emby-Icon-Studio/)
[![Vanilla JS](https://img.shields.io/badge/技术栈-原生%20HTML%2FCSS%2FJS-e8a33d?logo=javascript&logoColor=white)](#技术栈)
[![License](https://img.shields.io/badge/License-MIT-16a34a?logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Backend](https://img.shields.io/badge/后端-无-64748b?logo=serverless&logoColor=white)](#工作原理)

[**🚀 立即使用 →**](https://wliky.github.io/Emby-Icon-Studio/)

</div>

---

## 它解决的问题

给 Emby / Jellyfin 配图标时，你其实在做五件麻烦事：找图 → 裁形状 → 调透明度 → 统一尺寸 → 找地方托管拿 URL。

Emby Icon Studio 把这一整条链路压缩成一个网页。图标直接写进你的 GitHub 仓库，`raw.githubusercontent.com` 天然就是稳定免费的 CDN。

---

## 目录

- [功能](#功能)
- [快速开始](#快速开始)
- [外观与主题](#外观与主题)
- [设置访问密码](#设置访问密码)
- [工作原理](#工作原理)
- [项目结构](#项目结构)
- [自己部署一份](#自己部署一份)
- [常见问题](#常见问题)
- [路线图](#路线图)
- [技术栈](#技术栈)

---

## 功能

### 图标制作

| | 功能 | 说明 |
|:--:|---|---|
| 🖼 | **上传与拖拽** | PNG / JPG / JPEG / WEBP / GIF，单张最大 10MB |
| ✂️ | **双形状裁剪** | 圆形 / 方形，实时 512×512 预览 |
| 🔍 | **缩放移动** | 滚轮缩放 50%–300%，拖动调整构图，支持触屏 |
| 🎚 | **透明度** | 10%–100%，默认 80%，只作用于输出不破坏原图 |
| 🔤 | **中文转拼音** | 名称填「羊羊羊」自动命名 `yangyangyang.png` |
| 📦 | **统一输出** | 固定 512×512 RGBA PNG |

### 图标管理

| | 功能 | 说明 |
|:--:|---|---|
| 🔎 | **搜索** | 按名称或文件名实时过滤，带命中计数 |
| ✏️ | **重命名** | 直接改显示名称，不用删了重传 |
| 🔗 | **复制 URL** | 一键复制，粘贴到 Emby 即用 |
| 📋 | **批量导出** | 导出全部图标 URL 为 txt（名称 + Tab + 地址） |
| 🔄 | **手动刷新** | 随时重新拉取索引，不用改配置触发 |
| 🗑 | **删除** | 同时清理 PNG 与索引，二次确认 |

<div align="center">
  <img src="https://img.shields.io/badge/移动端-完整适配-3b82f6?style=for-the-badge" alt="移动端适配">
  <img src="https://img.shields.io/badge/主题-浅色%2F深色%2F跟随系统-8b5cf6?style=for-the-badge" alt="主题切换">
  <img src="https://img.shields.io/badge/设置-密码保护-ef4444?style=for-the-badge" alt="密码保护">
</div>

---

## 快速开始

### 1️⃣ 生成 GitHub Token

打开 **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**：

| 配置项 | 值 |
|---|---|
| **Repository access** | `Only selected repositories` → 选你要存图标的仓库 |
| **Repository permissions** | `Contents` → **Read and write** |

生成后复制 token（`github_pat_` 开头）。

> ⚠️ Token 只存在你自己的浏览器 localStorage，不提交到仓库、不发往任何第三方服务器。

### 2️⃣ 填配置

打开 [Emby Icon Studio](https://wliky.github.io/Emby-Icon-Studio/)，点右上角 **🔒 GitHub 设置**：

| 字段 | 示例 | 说明 |
|---|---|---|
| GitHub 用户名 | `Wliky` | 仓库所有者 |
| 仓库 | `Emby-Icon-Studio` | 存图标的仓库 |
| 分支 | `main` | 目标分支 |
| 图标目录 | `icons` | 存放 PNG 的目录，不存在会自动创建 |
| GitHub Token | `github_pat_xxx` | 上一步生成的 token |

保存时会自动校验仓库和分支是否可达。填错用户名或 Token 会直接拦下来，不会存一份用不了的配置。

### 3️⃣ 上传第一张图标

拖图进页面 → 调整裁剪框 → 填名称 → **生成 PNG**。

几秒后图标出现在下方列表，点 **复制 URL**：

```
https://raw.githubusercontent.com/Wliky/Emby-Icon-Studio/main/icons/yangyangyang.png
```

---

## 外观与主题

界面采用**玻璃拟态**风格：半透明磨砂卡片、渐变强调色、背景缓慢流动的光斑。

右上角 **🌓** 按钮循环切换三种主题：

| 图标 | 主题 | 说明 |
|:--:|---|---|
| 🌓 | 跟随系统 | **默认**。随操作系统的浅色/深色设置自动切换 |
| ☀️ | 浅色 | 强制浅色 |
| 🌙 | 深色 | 强制深色 |

选择会记在本机，下次打开保持。移动端浏览器的地址栏配色也会跟着变。

> 系统开启了「减弱动效」时，背景光斑会自动停止动画。

---

## 设置访问密码

「GitHub 设置」可以加一道锁，防止别人在你电脑上随手改配置或翻 Token。

**工作方式**

1. 第一次点开设置 → 要求你设置一个访问密码（至少 4 位）
2. 之后每次点开 → 先验证密码，通过后才显示已保存的信息
3. **刷新页面后需要重新验证**（解锁状态只在当前标签页有效）

**关于密码本身**

- 用 `SHA-256` + 随机 salt 存储，**只存哈希，不存明文**，没有找回途径
- 密码与哈希都只在本机 localStorage，不上传任何地方
- 忘了密码只能点「忘记密码？重置本机数据」—— 清除本机密码与 GitHub 配置，**仓库里的图标不受影响**
- 若通过 `file://` 直接打开（非 HTTPS），浏览器不提供 Web Crypto，密码保护会自动跳过

---

## 工作原理

```
        ┌────────────────────────────────┐
        │      浏览器 · GitHub Pages      │
        │                                │
        │   Emby Icon Studio（纯静态）    │
        │   HTML + CSS + JS（无构建）     │
        └───────────────┬────────────────┘
                        │
                        │  GitHub REST API
                        │  Bearer Token
                        ▼
        ┌────────────────────────────────┐
        │        你的 GitHub 仓库         │
        │                                │
        │  icons/                        │
        │  ├── yangyangyang.png          │
        │  └── xinghe.png                │
        │                                │
        │  data/                         │
        │  └── icons.json                │
        └────────────────────────────────┘
```

索引文件只存名称与文件名：

```json
[
  { "name": "羊羊羊", "file": "yangyangyang.png" }
]
```

> 图标地址由**当前配置实时拼出**，不写死在索引里 —— 换仓库、换分支、换目录后，历史图标地址自动跟着生效。

---

## 项目结构

```
emby-icon-studio/
├── index.html                 # 单页应用
├── assets/
│   ├── app.js                 # 编辑器 / GitHub API / 索引维护 / 主题 / 密码
│   └── style.css              # 玻璃拟态样式 + 浅色/深色双主题
├── icons/                     # 图标存放目录（内容由页面写入）
├── data/
│   └── icons.json             # 图标索引
├── .github/
│   └── workflows/
│       └── deploy.yml         # 构建 _site 并发布到 GitHub Pages
├── docs/
│   └── 开发文档.md             # 完整设计文档（32 节）
├── LICENSE
└── .gitignore
```

---

## 自己部署一份

1. Fork 或克隆本仓库
2. **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
3. push 到 `main`，`deploy.yml` 自动构建发布
4. 访问 `https://<用户名>.github.io/<仓库名>/`

工作流会先把站点文件 rsync 到 `_site/`（排除 `.git`、`.github`、`docs` 等非运行资源），再打包上传。

---

## 常见问题

<details>
<summary><b>Token 安全吗？</b></summary>

只存在浏览器 localStorage，请求直连 `api.github.com`，代码里没有任何数据上报。建议用 Fine-grained token 并限定到单个仓库，随时可在 GitHub 吊销。

想清除：设置弹窗里点「清除本机配置」。
</details>

<details>
<summary><b>上传后缩略图短暂 404？</b></summary>

正常现象。`raw.githubusercontent.com` 有几秒到一分钟的 CDN 缓存延迟。页面会自动带时间戳参数刷新，稍等或点「刷新」即可。
</details>

<details>
<summary><b>能换仓库或换目录吗？</b></summary>

可以。改配置后地址按新配置重新计算，已存在的图标条目不会丢。
</details>

<details>
<summary><b>为什么输出固定 512×512？</b></summary>

Emby、Fileball、SenPlayer、Yamby 等客户端对尺寸要求不一，512×512 兼容性最好，客户端会自行缩放。
</details>

<details>
<summary><b>忘密码了怎么办？</b></summary>

哈希不可逆，无法找回。点「忘记密码？重置本机数据」清除本机密码与配置，重新设置即可 —— 仓库中的图标文件不受影响。
</details>

<details>
<summary><b>支持批量上传吗？</b></summary>

暂不支持，属于后续规划，见下方路线图。
</details>

---

## 路线图

- [ ] 批量上传与批量生成
- [ ] 索引与 `icons/` 目录的孤儿条目校验清理
- [ ] 拖拽排序并同步 JSON 顺序
- [ ] 浏览器端自动抠背景（`@imgly/background-removal`）
- [ ] 自动化测试

---

## 技术栈

原生 **HTML5 + CSS3 + JavaScript ES6+**，用到：

`Canvas API` · `File API` · `GitHub REST API` · `Web Crypto API` · `CSS Backdrop Filter` · `prefers-color-scheme`

没有框架，没有构建工具，没有 npm 依赖。

---

## 文档

完整架构设计与开发说明见 [`docs/开发文档.md`](docs/开发文档.md)，含核心设计、目录规范、API 调用细节、错误处理、UI 规范与第二阶段规划。

---

<div align="center">

[MIT](LICENSE) © Wliky

</div>
