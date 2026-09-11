# Icon

**自建 Emby 图标库。** 上传图标，得到一个标准 JSON 订阅地址，主流 Emby 三方客户端直接加载。

<p>
  <a href="https://github.com/Wliky/Icon"><img alt="仓库" src="https://img.shields.io/badge/repo-Wliky%2FIcon-181717?logo=github"></a>
  <a href="https://wliky.github.io/Icon/"><img alt="在线使用" src="https://img.shields.io/badge/在线使用-wliky.github.io%2FIcon-4f46e5"></a>
  <a href="LICENSE"><img alt="许可证" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="依赖" src="https://img.shields.io/badge/依赖-零-ff6b6b">
</p>

---

## 它解决什么问题

Emby 的第三方客户端（Fileball、Yamby、Hills、Senplayer、小幻影视等）都支持「图标库 / 图标订阅」：
填一个 JSON 地址，客户端就会把你自己的图标加载进去，用来给媒体库换图标。

**Icon 就是帮你生成并维护这个 JSON 地址的工具。** 你只管往里丢图，地址永远有效、永远最新。

```
你上传图标  ──▶  Icon  ──▶  data/iconset.json  ──▶  客户端订阅  ──▶  Emby 里用上
```

## 特性

| | |
|---|---|
| **上传即用** | 图片原样保存，不裁剪、不压缩、不转格式 |
| **批量上传 / 下载** | 一次拖多张；勾选后打包成 ZIP 一次下载 |
| **按需裁剪** | 上传后可单独裁剪，默认输出 **108 × 108**，可选 256 / 512，方形或圆形 |
| **标准输出** | 产出 `{ name, description, icons: [{ name, url }] }`，各家客户端通用 |
| **只填一个 Token** | 仓库信息从当前网址自动识别 |
| **双地址** | jsDelivr（国内稳）/ GitHub Raw（即时），随时切换 |
| **页面背景** | 设置里填一张图片 URL 当页面背景，只存本机，不影响订阅 |
| **纯静态** | 无后端、无构建、零依赖，GitHub Pages 直接托管 |
| **中文文件名** | 中文名自动转拼音，生成干净的文件名 |
| **密码锁** | 「设置」可加访问密码，哈希只存本机 |
| **响应式 + 深浅色** | 默认跟随系统，也可手动固定 |

## 三分钟开始

### 1. 建一个 Token

GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → *Generate new token*

- **Repository access**：只选这个仓库
- **Permissions** → **Contents**：`Read and write`

> 建议用 Fine-grained Token，权限最小化。Classic Token 勾 `repo` 也行，但权限给得太大。

### 2. 粘进页面

打开 [Icon](https://wliky.github.io/Icon/) → 右上角 **设置** → 粘贴 Token → **保存并连接**。

仓库、分支、目录会自动识别，不用填。如果想把图标存到别的仓库，展开「高级」手动改。

### 3. 上传，然后复制地址

拖图片进去 → 顶部「图标库订阅地址」复制 → 粘到客户端里。

## 日常操作

### 批量上传

把多张图片一起拖进页面，或点「上传图标」多选。会逐个上传并自动处理重名，单个失败不打断其余的，最后统一汇报结果。

### 批量下载

点工具条的 **批量** 进入选择模式 → 勾选图标 → **打包下载 ZIP**。
打包用的是 [JSZip](https://stuk.github.io/jszip/)（CDN 按需加载）；加载不到时自动降级为逐个下载。

### 裁剪图标

上传时图片是**原样保存**的，需要裁剪就点卡片上的裁剪按钮：

- 拖动图片调整位置，滚轮或滑块缩放
- 输出尺寸 **108 / 256 / 512**，**默认 108 × 108**
- 形状可选方形或圆形（圆形四周为透明）
- 保存后覆盖原图。如果原图不是 PNG，会自动换成 `.png` 并更新索引

### 页面背景

设置 → 页面背景 → 填一张图片的 URL，即可把它铺成页面背景；下面的滑块调遮罩浓度，保证文字可读。
背景只存在你的浏览器里，不会写进仓库，也不影响订阅地址。

## 在客户端里怎么用

复制订阅地址，打开客户端的 **图标库 / 图标订阅 / 自定义图标** 一类的入口，把地址粘进去保存即可。

订阅地址形如：

```
https://cdn.jsdelivr.net/gh/Wliky/Icon@main/data/iconset.json      # 推荐，国内可直连
https://raw.githubusercontent.com/Wliky/Icon/main/data/iconset.json # 即时，国内可能打不开
```

输出的 JSON 长这样：

```json
{
  "name": "Icon",
  "description": "共 2 个图标 · 更新于 2026-09-11",
  "icons": [
    { "name": "电影", "url": "https://raw.githubusercontent.com/Wliky/Icon/main/icons/dian-ying.png" },
    { "name": "剧集", "url": "https://raw.githubusercontent.com/Wliky/Icon/main/icons/ju-ji.png" }
  ]
}
```

> 更换仓库、分支或目录后，地址会重新拼装，历史图标不会失效。

## 为什么需要 GitHub 配置

这是纯静态项目，**没有后端、没有数据库**。图标必须有个地方存，而且要能被客户端公网访问。

所以直接拿 GitHub 仓库当存储：

- **仓库** = 硬盘，存图片和索引
- **GitHub Pages** = 免费托管这个管理页面
- **raw / jsDelivr** = 免费图床，给客户端提供图片地址

代价只有一个：你得给页面一个 Token，让它替你往仓库里写文件。**Token 只存在你自己的浏览器里**，不上传、不进仓库。

已经做了两件事降低这个代价：

1. 仓库信息从网址自动推断，你只填 Token
2. 「设置」支持访问密码，别人拿到你的电脑也看不到 Token

## 目录结构

```
Icon/
├── index.html                 # 管理页面
├── assets/
│   ├── style.css
│   └── app.js                 # 全部逻辑（无框架、无构建）
├── data/
│   ├── icons.json             # 图标索引：[{ name, file }]
│   └── iconset.json           # 客户端订阅文件（标准格式）
├── icons/                     # 图片原样存放
└── .github/workflows/deploy.yml
```

## 常见问题

<details>
<summary><b>Token 安全吗？</b></summary>

Token 只写进浏览器的 `localStorage`，不会提交到仓库，也不会发给除 GitHub 之外的任何地方。
页面是纯前端，所有请求都是你的浏览器直接打给 `api.github.com`。

保险起见，用 Fine-grained Token 且只给这一个仓库的 Contents 权限——就算泄露，影响范围也就这一个仓库。
</details>

<details>
<summary><b>jsDelivr 和 GitHub Raw 该选哪个？</b></summary>

- **jsDelivr**：国内基本都能开，推荐给客户端用。新上传的图标最多延迟几分钟同步。
- **GitHub Raw**：即时生效，但国内网络经常连不上。

客户端加载不出来时，换成 jsDelivr 那条。
</details>

<details>
<summary><b>上传的图标会被处理吗？</b></summary>

不会。图片按原样保存，不裁剪、不压缩、不转格式、不加水印。
唯一改动是文件名：中文名转拼音、非法字符换成 `-`、重名自动加序号。
</details>

<details>
<summary><b>能存多少个图标？</b></summary>

GitHub 单个仓库建议控制在 1GB 以内。按单张 100KB 算，几千个图标没问题。
页面做了分批渲染，图标多了也不会卡。
</details>

<details>
<summary><b>换设备 / 换浏览器怎么办？</b></summary>

图标本身在 GitHub 仓库里，不会丢。新设备上重新填一次 Token 就能看到全部图标——
索引是从仓库读的，不依赖本机。
</details>

<details>
<summary><b>忘了「设置」的访问密码？</b></summary>

密码只以 salt + hash 形式存在本机，不可逆，找不回来。
在验证弹窗里点「忘记密码？重置本机数据」，会清掉本机密码和配置，重新填 Token 即可，仓库数据不受影响。
</details>

## 技术说明

- 纯原生 HTML / CSS / JS，无框架、无构建步骤、无 npm 依赖
- 通过 [GitHub REST API](https://docs.github.com/rest) 直接读写仓库文件
- 写操作带 SHA 校验，遇到 409 冲突自动重试
- 响应式断点：1024px / 760px / 420px，支持 `prefers-reduced-motion`
- 主题默认跟随系统（`prefers-color-scheme`），可手动固定浅色 / 深色

## 许可证

[MIT](LICENSE) © Wliky
