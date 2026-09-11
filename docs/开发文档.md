Emby Icon Studio 开发文档
1. 项目概述

项目名称： Emby Icon Studio

项目定位：

一个部署在 GitHub Pages 上的个人 Emby 图标管理与制作工具。

主要用于：

上传本地图标
在线裁剪
圆形 / 方形裁剪
图片缩放、移动
调整透明度
生成统一尺寸 PNG
保存至 GitHub 仓库
自动维护图标 JSON 索引
浏览已有图标
复制图标 URL
删除已有图标

项目主要面向个人自用，因此不需要传统后端服务器、数据库或 Docker。

2. 核心设计

整体采用：

┌────────────────────────────┐
│       GitHub Pages         │
│                            │
│     Emby Icon Studio       │
│                            │
│  HTML + CSS + JavaScript   │
└─────────────┬──────────────┘
              │
              │ GitHub REST API
              ↓
┌────────────────────────────┐
│      GitHub Repository     │
│                            │
│ icons/                     │
│ ├── icon-a.png             │
│ ├── icon-b.png             │
│ └── icon-c.png             │
│                            │
│ data/                      │
│ └── icons.json             │
└────────────────────────────┘

不设置独立后端。

3. 技术栈
前端

使用原生：

HTML5
CSS3
JavaScript ES6+
Canvas API
File API
GitHub REST API

第一版不强制使用 React/Vue。

原因：

GitHub Pages 原生支持
无构建环境
项目体积小
部署简单
维护方便
个人项目足够使用

后续如果功能越来越复杂，再迁移到 React。

4. 项目目录

最终项目结构：

emby-icon-studio/
│
├── index.html
│
├── assets/
│   ├── app.js
│   └── style.css
│
├── icons/
│   └── .gitkeep
│
├── data/
│   └── icons.json
│
├── .github/
│   └── workflows/
│       └── deploy.yml
│
├── README.md
├── LICENSE
└── .gitignore
5. 页面结构
5.1 顶部导航

显示：

🎬 Emby Icon Studio

自用图标管理器

[ GitHub 设置 ]
[ GitHub ]
6. 首页

首页主要分为两个区域。

6.1 图标上传
我的 Emby 图标库

[＋ 上传图标]

支持：

PNG
JPG
JPEG
WEBP
GIF

最大文件大小建议：

10 MB

超过大小提示：

图片不能超过 10MB
7. 图标编辑器

用户上传图片后打开编辑器。

页面：

┌─────────────────────────────────────────┐
│ 图标编辑                           关闭 │
├───────────────────┬─────────────────────┤
│                   │                     │
│                   │ 图标名称             │
│                   │ [_______________]   │
│                   │                     │
│     原始图片       │ 裁剪形状             │
│                   │ ○ 圆形              │
│                   │ □ 方形              │
│                   │                     │
│                   │ 透明度               │
│                   │ ━━━━━━━●━━ 80%      │
│                   │                     │
│                   │ 缩放                 │
│                   │ ━━━━━●━━━━ 100%     │
│                   │                     │
│                   │ [生成 PNG]           │
│                   │ [重置]              │
└───────────────────┴─────────────────────┘
8. 图片裁剪
8.1 图片操作

支持：

移动

鼠标拖动：

pointerdown
pointermove
pointerup

修改：

x
y
缩放

鼠标滚轮：

向上 → 放大
向下 → 缩小

同时提供 Slider：

50% ───────── 300%

默认：

100%
9. 裁剪区域

默认：

360 × 360

输出：

512 × 512

圆形：

border-radius: 50%;

方形：

border-radius: 0;

裁剪区域外围使用遮罩：

box-shadow:
0 0 0 9999px rgba(0,0,0,.7);

让用户能够清楚看到最终区域。

10. 透明度处理

提供：

10% ───────── 100%

默认：

80%

Canvas 使用：

ctx.globalAlpha = opacity;

例如：

ctx.globalAlpha = 0.8;

注意：

透明度应该应用到最终输出，而不是修改原始图片。

11. 输出标准

所有生成图片统一：

格式：PNG
尺寸：512 × 512
颜色：RGBA

例如：

icons/
└── yangyangyang.png

这样方便：

Emby
Fileball
SenPlayer
Yamby
Hills

等客户端使用。

12. 图片生成流程
原始图片
   ↓
读取 Image
   ↓
计算缩放比例
   ↓
Canvas 512×512
   ↓
创建圆形/方形 Clip
   ↓
绘制图片
   ↓
应用透明度
   ↓
Canvas.toBlob()
   ↓
PNG

核心：

canvas.toBlob(
    callback,
    "image/png",
    1
);
13. 图标命名

用户输入：

羊羊羊

系统自动生成文件名：

yangyangyang.png

如果无法转换，则生成：

icon.png

如果重复：

icon-2.png
icon-3.png

推荐最终采用稳定的 slug：

name → slug → filename

例如：

Lemon Emby
↓
lemon-emby.png
14. GitHub 配置

设置页面：

GitHub 用户名
[ yourname ]

仓库
[ emby-icon ]

分支
[ main ]

图标目录
[ icons ]

GitHub Token
[ **************** ]

保存后：

localStorage

保存配置。

15. GitHub Token 安全

项目不应该：

❌ 把 Token 写进 app.js
❌ 把 Token 提交到 GitHub
❌ 把 Token 放到 URL
❌ 把 Token 上传到第三方服务器

只允许：

浏览器
 ↓
localStorage
 ↓
GitHub API

建议使用 GitHub Fine-grained Personal Access Token。

权限只需要目标仓库：

Repository access
└── Only selected repositories

Repository permissions
└── Contents
    └── Read and write
16. GitHub API

保存 PNG：

PUT
/repos/{owner}/{repo}/contents/{path}

例如：

icons/yangyangyang.png

请求核心：

{
  "message": "feat: add icon yangyangyang",
  "content": "BASE64",
  "branch": "main"
}

如果文件已经存在，需要先获取：

sha

然后：

{
  "message": "feat: update icon",
  "content": "BASE64",
  "sha": "xxxx",
  "branch": "main"
}
17. icons.json

图标索引：

[
  {
    "name": "羊羊羊",
    "file": "yangyangyang.png",
    "url": "https://raw.githubusercontent.com/USER/REPO/main/icons/yangyangyang.png"
  }
]

完整示例：

[
  {
    "name": "羊羊羊",
    "file": "yangyangyang.png",
    "url": "https://raw.githubusercontent.com/example/emby-icon/main/icons/yangyangyang.png"
  },
  {
    "name": "星河",
    "file": "xinghe.png",
    "url": "https://raw.githubusercontent.com/example/emby-icon/main/icons/xinghe.png"
  }
]
18. JSON 自动更新

每次新增图标：

上传 PNG
    ↓
读取 icons.json
    ↓
追加新图标
    ↓
排序
    ↓
上传 icons.json

排序：

中文名称 → localeCompare("zh")
19. 图标展示

首页读取：

data/icons.json

然后生成：

┌───────┐
│       │
│  🐑   │
│       │
└───────┘
羊羊羊

[复制URL]
[删除]
20. 搜索

顶部：

🔍 搜索图标……

支持：

名称搜索

例如输入：

羊

显示：

羊羊羊
羊村
羊影
21. 复制 URL

点击：

复制 URL

复制：

https://raw.githubusercontent.com/USER/REPO/main/icons/xxx.png

然后提示：

✓ URL 已复制
22. 删除图标

点击：

删除

弹窗：

确定删除「羊羊羊」？

[取消] [删除]

删除流程：

获取 GitHub 文件 SHA
       ↓
DELETE API
       ↓
删除 PNG
       ↓
更新 icons.json
23. GitHub Pages 部署

GitHub 仓库：

emby-icon-studio

进入：

Settings
 ↓
Pages
 ↓
Build and deployment
 ↓
Deploy from a branch
 ↓
main
 ↓
/ (root)

最终：

https://用户名.github.io/emby-icon-studio/
24. GitHub Actions

建议加入：

.github/workflows/deploy.yml

用于自动部署 GitHub Pages。

工作流程：

git push
   ↓
GitHub Actions
   ↓
部署 Pages
   ↓
网站更新
25. UI 设计

整体建议：

暗色 + Emby 影视风格

背景：

#0b0d12

卡片：

#11151d

边框：

#252b37

按钮：

浅色按钮

重点不是完全照搬 Emby，而是做成：

影视服务器管理工具 + 极简现代 UI

推荐：

圆角：12~20px

卡片：轻微阴影

按钮：圆角

图片：棋盘格透明背景

字体：系统字体

移动端必须兼容。

26. 移动端

手机访问时：

编辑器
↓
上下排列

而不是：

左右排列

例如：

原图

        ↓

裁剪

        ↓

透明度

        ↓

预览

        ↓

生成
27. 错误处理

必须处理：

GitHub Token 错误
GitHub Token 无效或权限不足
仓库不存在
无法访问指定仓库，请检查用户名和仓库名称
分支不存在
指定分支不存在
API 限流
GitHub API 请求过于频繁，请稍后再试
图片错误
无法读取图片
28. 数据缓存

浏览图标时优先：

icons.json

可以缓存：

5分钟

避免每次刷新都请求 GitHub。

29. 不需要的功能

第一版明确不做：

❌ 用户注册
❌ 用户登录系统
❌ MySQL
❌ Redis
❌ 独立服务器
❌ 用户社区
❌ 评论
❌ 点赞
❌ 多用户权限
❌ 在线 AI 抠图

因为这是个人自用工具。

30. 第二阶段可以增加

后续可以加入：

自动抠背景

例如：

上传图片
 ↓
自动识别主体
 ↓
删除背景
 ↓
生成透明 PNG

这个功能如果纯浏览器实现，可以考虑：

@imgly/background-removal

这样无需上传图片到第三方服务器。

批量处理

一次：

上传 20 张

自动：

裁剪
透明度
512×512
PNG

然后批量提交 GitHub。

拖拽排序

可以自定义：

1. 羊羊羊
2. 星河
3. 月影
4. 影视

并同步 JSON 顺序。

31. 推荐的最终版本

我建议第一版就做成：

                    Emby Icon Studio
                           │
           ┌───────────────┴───────────────┐
           │                               │
        图标库                            编辑器
           │                               │
     icons.json                       上传图片
           │                               │
     图标搜索                         图片裁剪
           │                               │
     URL复制                           缩放/移动
           │                               │
     删除图标                           透明度
                                           │
                                        512×512
                                           │
                                           ↓
                                      GitHub API
                                           │
                              ┌────────────┴───────┐
                              │                    │
                           icons/*.png        icons.json
32. 第一版验收标准

项目完成后必须满足：

 GitHub Pages 可以直接打开
 无后端
 可以上传图片
 可以拖动图片
 可以缩放图片
 支持圆形裁剪
 支持方形裁剪
 支持透明度调整
 输出 512×512 PNG
 可以输入图标名称
 可以保存到 GitHub
 自动生成 icons.json
 可以浏览图标
 可以搜索图标
 可以复制图标 URL
 可以删除图标
 GitHub Token 不提交到仓库
 PC / 手机均可使用

最终目标不是做一个公开图标社区，而是做一个你自己的「Emby 图标制作 + GitHub 图标仓库管理器」。
