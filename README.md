# Emby Icon Studio

> 纯前端的 Emby 图标制作与管理工具，跑在 GitHub Pages 上，用 GitHub 仓库当图床。
> 无后端、无数据库、无需部署服务器。

🔗 **在线使用：** https://wliky.github.io/Emby-Icon-Studio/

---

## 它解决什么问题

给 Emby / Jellyfin 之类的媒体库配图标时，你通常需要：

1. 找一张图
2. 裁成圆形或方形
3. 调整透明度，让它在 Emby 的暗色背景上不刺眼
4. 统一输出成 512×512 的 PNG
5. 想办法托管它，拿到一个稳定的公开 URL

Emby Icon Studio 把这一整条链路做成了浏览器里的一个页面，图标直接存进你自己的 GitHub 仓库，`raw.githubusercontent.com` 天然就是稳定的 CDN。

---

## 功能

| | 功能 | 说明 |
|---|---|---|
| 🖼 | 上传与拖拽 | 支持 PNG / JPG / JPEG / WEBP / GIF，单张最大 10MB |
| ✂ | 裁剪 | 圆形 / 方形两种形状，实时 512×512 预览 |
| 🔍 | 缩放与移动 | 滚轮缩放（50%–300%），鼠标或手指拖动调整构图 |
| 🎚 | 透明度 | 10%–100%，默认 80%，只作用于输出不影响原图 |
| 🔤 | 中文自动转拼音 | 名称「羊羊羊」自动生成 `yangyangyang.png` |
| 📦 | 统一输出 | 固定 512×512 RGBA PNG |
| 🔗 | 一键复制 URL | 直接粘贴到 Emby 使用 |
| ✏️ | 重命名 | 改图标名称，不必删了重传 |
| 📋 | 批量导出 | 一次性导出全部图标 URL |
| 🔎 | 搜索 | 按名称或文件名过滤 |
| 🗑 | 删除 | 同时清理 PNG 与索引，带二次确认 |
| 📱 | 移动端适配 | 手机上编辑器自动改为上下排列 |

---

## 三分钟上手

### 1. 准备一个 GitHub Token

访问 **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**，按下面配置：

- **Repository access**：Only selected repositories → 选你要存图标的仓库（可以和本工具同一个仓库）
- **Repository permissions**：Contents → **Read and write**

生成后复制 token（`github_pat_` 开头）。

> ⚠️ 这个 token 只保存在你自己的浏览器 localStorage 里，不会提交到仓库，也不会发往任何第三方服务器。

### 2. 在页面里填配置

打开 [Emby Icon Studio](https://wliky.github.io/Emby-Icon-Studio/)，点右上角 **GitHub 设置**：

| 字段 | 示例 | 说明 |
|---|---|---|
| GitHub 用户名 | `Wliky` | 仓库所有者 |
| 仓库 | `Emby-Icon-Studio` | 存图标的仓库名 |
| 分支 | `main` | 目标分支 |
| 图标目录 | `icons` | 仓库内存放 PNG 的目录，不存在会自动创建 |
| GitHub Token | `github_pat_xxx` | 上一步生成的 token |

保存时会自动校验仓库和分支是否可达，配置有误会直接提示。

### 3. 上传第一张图标

拖一张图片进页面 → 调整裁剪框 → 填名称 → **生成 PNG**。

几秒后图标出现在下方列表，点 **复制 URL** 就能拿到：

```
https://raw.githubusercontent.com/Wliky/Emby-Icon-Studio/main/icons/yangyangyang.png
```

---

## 工作原理

```
浏览器 (GitHub Pages)
   │
   │  GitHub REST API（Bearer Token）
   ↓
GitHub 仓库
   ├── icons/*.png      图标文件
   └── data/icons.json  图标索引
```

整个应用只有三个文件，`index.html` + `assets/app.js` + `assets/style.css`，没有构建步骤，没有 npm 依赖。索引文件长这样：

```json
[
  {
    "name": "羊羊羊",
    "file": "yangyangyang.png"
  }
]
```

> `url` 字段不再写入索引 —— 图标地址由当前配置实时拼出，这样换仓库或换分支后历史图标不会失效。

---

## 项目结构

```
emby-icon-studio/
├── index.html              # 单页应用
├── assets/
│   ├── app.js              # 全部逻辑：编辑器 / GitHub API / 索引维护
│   └── style.css
├── icons/                  # 图标存放目录（内容由页面写入）
├── data/
│   └── icons.json          # 图标索引
├── .github/workflows/
│   └── deploy.yml          # 自动部署到 GitHub Pages
├── docs/
│   └── 开发文档.md          # 完整设计文档（32 节）
├── LICENSE
└── .gitignore
```

---

## 自己部署一份

1. Fork 或克隆本仓库
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
3. push 到 `main`，`deploy.yml` 自动构建发布
4. 访问 `https://<你的用户名>.github.io/<仓库名>/`

首次部署后，工作流会把站点产物（不含源码、`.git`、文档）打包上传。

---

## 常见问题

**Q：Token 安全吗？**
只存在浏览器 localStorage，请求直连 `api.github.com`，代码里没有任何数据上报。建议用 Fine-grained token 并限定到单个仓库，随时可以在 GitHub 上吊销。换设备或想清除：设置弹窗里点「清除配置」。

**Q：上传后缩略图短暂 404？**
正常。`raw.githubusercontent.com` 有几秒到一分钟的 CDN 缓存延迟，页面会自动带上时间戳参数刷新，稍等或点「刷新」即可。

**Q：能换仓库或换目录吗？**
可以。改配置后图标地址会按新配置重新计算，已存的图标条目不会丢。

**Q：为什么输出固定 512×512？**
Emby、Fileball、SenPlayer、Yamby 等客户端对图标尺寸要求不一，512×512 是兼容性最好的尺寸，客户端会自行缩放。

**Q：支持批量上传吗？**
暂不支持，属于后续规划（见开发文档第 30 节）。

---

## 技术栈

原生 HTML5 + CSS3 + JavaScript ES6+，用到 Canvas API、File API、GitHub REST API。没有框架、没有构建工具。

---

## 文档

完整的架构设计与开发说明见 [`docs/开发文档.md`](docs/开发文档.md)，包含核心设计、目录规范、API 调用细节、错误处理、UI 规范与第二阶段规划。

---

## License

[MIT](LICENSE) © Wliky
