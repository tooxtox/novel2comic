# 小说⇄漫画 双向转换器

> 一个完整的 Web 应用,使用大语言模型 (LLM) + 图像生成 API 将小说转换为日式黑白漫画,也支持将漫画图片反向转换为小说文本。

[![Python](https://img.shields.io/badge/Python-3.8%2B-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-2.0%2B-green.svg)](https://flask.palletsprojects.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📖 目录

- [功能特性](#-功能特性)
- [快速开始](#-快速开始)
- [使用指南](#-使用指南)
- [配置说明](#-配置说明)
- [镜头语言映射](#-镜头语言映射)
- [对话气泡本地渲染](#-对话气泡本地渲染)
- [作品保存与导入](#-作品保存与导入)
- [API 接口](#-api-接口)
- [项目结构](#-项目结构)
- [常见问题](#-常见问题)
- [开发计划](#-开发计划)
- [许可证](#-许可证)

---

## ✨ 功能特性

### 🎨 核心功能

| 功能 | 说明 |
|------|------|
| **智能分镜** | 自动将小说分解为漫画分镜,支持结构化镜头语言(视角/构图/情绪/景别/光照/场景类型) |
| **黑白漫画生成** | 调用图像生成 API 生成日式黑白漫画风格图像 |
| **角色管理** | 自动提取小说角色、生成人设图、保持角色一致性,支持一键清空角色 |
| **分镜合并** | 将单页分镜合并为完整漫画页,支持自适应网格布局 |
| **对话气泡** | 自动为分镜添加对话气泡,支持 4 种类型(对话/心理/喊叫/旁白) |
| **作品历史** | 按账号保存、加载、重命名、删除作品 |
| **漫画转小说** | 支持将漫画图片批量转换为小说文本(支持视觉 LLM) |
| **PIL 本地渲染文字** | 图像 API 只产出干净画面,对话文字+气泡由后端 PIL 本地叠加,彻底杜绝乱码 |

### 🎯 特色功能

- **WebSocket 实时进度** — 基于 Flask-SocketIO 的双向通信,长任务进度实时推送,告别假进度条
- **角色参考图** — 生成图像时选择出场角色,保持角色一致性
- **上一页自动参考** — 生成连续漫画页时自动把上一页整页图作为参考,保持视觉连贯(单页/批量都生效)
- **API 预设** — 火山引擎 v3 (MiniMax 文本 + 豆包图像) / OpenAI 等多种 API
- **配置灵活** — 支持自定义 API 接口地址、模型名称、负面提示词
- **分镜编辑** — 支持编辑场景描述、对话、镜头类型、视角、构图、情绪等结构化字段
- **批量生成** — 支持批量生成分镜图、整页图、拼版
- **暂停控制** — 批量生成时支持随时暂停/继续
- **人设图自定义** — 支持手动编辑人设图 prompt、手动上传图片
- **内网穿透恢复** — 支持 session 数据持久化,断开后自动恢复
- **越界气泡** — 对话气泡可超出分镜框,布局更灵活
- **每页分镜数 LLM 自由控制** — 设为 0 时由 LLM 根据情节节奏自由决定每页分镜数 (2-8 格)

### 🖼️ 8 种对话气泡类型 (LLM 分镜规划自动选型)

| 类型 | 样式 | 用途 | 触发场景 |
|------|------|------|----------|
| `dialogue` | 圆角矩形 (无尾) | 普通对话 | 默认 (80% 以上) |
| `thought` | 云形气泡 + 小圆尾巴 | 心理活动、思考 | "他想…""心里…" |
| `shout` | 爆炸/锯齿形 | 大喊、喊叫 | "啊——!""住手!" |
| `whisper` | 虚线圆角矩形 + 小尾 | 耳语、低语、秘密 | "…别出声""小声点" |
| `burst` | 椭圆 + 辐射射线 | 音爆、撞击、强烈声效 | "BOOM!""砰砰砰!" |
| `narration` | 朴素矩形(米黄底灰框) | 旁白、第三人称叙述 | "当时…""他走出…" |
| `box` | 白底黑实线矩形(无尾) | 普通矩形气泡 | 想区别于圆角 dialogue 时 |
| `caption` | 黑底白字矩形 | 拟声词/音效文字 | "嘶""砰"这种极短音 |

**自动选型机制**:
- **LLM 主动规划** — 智能分镜阶段 prompt 现在要求 LLM 为每个分镜选一个最贴合的 `dialogue_type` (如大喊 → shout, 心理活动 → thought)
- **启发式兜底** — LLM 漏填/填错/旧作品数据时, 后端会按正则规则自动推断(纯拟声 → caption/burst, 省略号 → whisper, 心理活动词 → thought, 多感叹号 → shout)
- **手动覆盖** — 分镜管理 Tab 中可下拉切换 8 种气泡形状, 实时生效

---

## 🚀 快速开始

### 环境要求

- **Python** 3.8 或更高版本
- **现代浏览器** (Chrome / Edge / Firefox / Safari)
- **API 密钥**: 文本 LLM API + 图像生成 API(支持 OpenAI 协议)

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd text2comic
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 启动服务

```bash
python app.py
```

启动成功后会看到:
```
 * Running on http://127.0.0.1:2778
 * Running on http://<your-ip>:2778
```

浏览器访问 **`http://localhost:2778`**

### 4. 首次配置

1. 使用管理员账号登录(**首次启动会自动生成随机密码,打印在控制台**)
2. 进入 **API 配置** Tab,填写 API 地址、Key、模型名称
3. 点击 **保存配置**,内容写入 `config.local.json`
4. 管理员密码和 session 密钥自动写入 `.env` 文件

> **⚠️ 安全提示**: 部署到公网前请修改 `.env` 中的 `MANGA_ADMIN_PASSWORD` 和 `MANGA_SECRET_KEY`

---

## 📖 使用指南

### 第一步:配置 API

1. 进入 **API 配置** Tab
2. 选择一个预设:
   - **🌋 火山引擎 v3** — MiniMax 文本 + 豆包图像(默认推荐)
   - **🟢 OpenAI 预设** — OpenAI 兼容接口
3. 预设会自动填入 API 地址和模型名,**只需填写 API Key**
   - 火山引擎:到 [方舟控制台](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) 创建 `ark-` 开头的 Key,文本/图像 API 共用
4. 点击 **保存配置**,内容写入 `config.local.json`

**推荐配置**:
- 文本 LLM: `minimax-m3-1-250227` (火山引擎方舟)
- 图像生成: `doubao-seedream-3-0-t2i-250415` (豆包 Seedream 3.0)

### 第二步:输入小说

1. 进入 **小说输入** Tab
2. 粘贴小说内容(**建议 3000–8000 字**)
3. **每页分镜数**(在「高级设置」中):
   - `0`(默认)= LLM 根据情节节奏自由决定每页分镜数 (2-8 格)
   - `2-8` = 作为建议值,LLM 仍可灵活调整

### 第三步:分析角色(可选但推荐)

1. 进入 **角色管理** Tab
2. 点击 **从小说分析角色**
3. 等待 LLM 分析完成(WebSocket 实时推送进度)
4. 为每个角色点击 **生成人设图**(基线图,失败自动重试)
5. 也可以点击 **📁 上传** 手动上传参考图
6. 可以点击 **✏️ Prompt** 编辑人设图生成 prompt
7. 切换小说/重新开始时,点击 **🗑️ 清空角色** 一键清除所有角色和分镜中的角色引用

> 💡 **角色合并**: 重新分析角色时,会智能合并新旧角色,保留已有的人设图和自定义 prompt

### 第四步:智能分镜

1. 进入 **小说输入** Tab
2. 点击 **开始智能分镜**(WebSocket 实时推送分镜进度)
3. 自动跳转到 **分镜管理** Tab
4. 可编辑每个分镜的场景描述、对话、镜头语言字段

> ⚠️ **自动拦截**: 如果角色还没生成人设图,会弹窗提示是否继续

### 第五步:生成图像

在 **分镜管理** Tab:
- 勾选出场角色(保持一致性)
- **生成图片** — 单张生成
- **批量生成图片** — 全部生成(支持暂停/继续,WebSocket 实时进度)
- **生成整页图** — 一键生成整页漫画
  - 第 1 页正常生成
  - 第 N 页 (N>1) **自动把第 N-1 页的整页图作为参考**,保持人物和画风一致
  - 批量生成时连续传递上一页图作为参考

### 第六步:合并漫画页

1. 进入 **漫画预览** Tab
2. 点击 **合并所有页面**
3. 系统自动完成:自适应网格布局 + 对话气泡 + 页码

### 第七步:查看作品历史

1. 进入 **历史记录** Tab
2. 查看、加载、重命名或删除作品
3. 数据保存在 `static/users/` 目录,重启不丢失

### 第八步:漫画转小说

1. 进入 **漫画转小说** Tab
2. 上传漫画图片(支持批量)
3. 填写视觉 LLM 的 API 地址、Key、模型
4. 生成按页拆分的小说文本

---

## ⚙️ 配置说明

### API 预设

| 预设 | LLM 模型 | 图像模型 | 说明 |
|------|---------|---------|------|
| **火山引擎 v3** | `minimax-m3-1-250227` | `doubao-seedream-3-0-t2i-250415` | 默认推荐,MiniMax 文本 + 豆包图像 |
| **OpenAI 预设** | `gpt-4` | (需自填) | OpenAI 兼容接口 |

> **获取火山引擎 API Key**: 登录 [火山引擎方舟控制台](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) → 「API Key 管理」→ 创建 API Key,复制以 `ark-` 开头的字符串。文本 API 和图像 API 共用同一个 Key。

### 环境变量 (.env)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MANGA_SECRET_KEY` | Flask session 签名密钥 | 自动随机生成 |
| `MANGA_ADMIN_USERNAME` | 管理员用户名 | `admin` |
| `MANGA_ADMIN_PASSWORD` | 管理员密码 | 自动随机生成 |
| `MANGA_LLM_MAX_TOKENS` | LLM 最大输出 token | `32768`(上限 128k) |

### 高级设置

- **每页分镜数** — 默认 `0` (LLM 自由控制)
  - `0` — LLM 根据情节节奏自由决定每页分镜数 (2-8 格)
  - `2-8` — 作为建议值,LLM 仍可灵活调整
- **负面提示词** — 避免不想要的风格(如彩色、模糊)
- **参考强度** — 0–1,控制角色参考图/上一页参考图的影响力度
  - **0.8–1.0** — 高度一致(严格保持角色外观,角色一致性优先)
  - **0.5–0.8** — 中度一致(推荐)
  - **0.0–0.5** — 弱参考(允许变化)
- **越界气泡** — 对话气泡是否可超出分镜框

### 模型规格(以火山引擎为例)

| 项目 | 值 |
|------|---|
| 上下文窗口 | 512k |
| 最大输出 | 128k |
| 推荐 `max_tokens` | 32768 (32k) |

**max_tokens 调优建议**:
- **12288 (12k)** — 保守,速度快,适合短分镜
- **32768 (32k)** — 默认,平衡速度与稳定性
- **65536 (64k)** — 长输出,适合 20+ 页分镜
- **131072 (128k)** — 极限,仅在必要时使用

---

## 🎬 镜头语言映射

LLM 输出的结构化镜头语言字段会自动转换为英文 tag 注入图像生成 prompt:

| 字段 | 中文枚举值 | 作用 |
|------|-----------|------|
| `camera_angle` | 俯视/仰视/平视/斜视/主观视角 | 视角控制 |
| `composition` | 三分法/对称/中心对称/框架式/引导线 | 构图控制 |
| `mood` | 紧张/紫蓝/紫红/暧昧/悲伤/温馨/压抑/恐怖 | 情绪氛围 |
| `shot_scale` | 大远景/远景/全景/中景/近景/特写/大特写 | 景别控制 |
| `lighting` | 硬光/背光/顶光/荧光灯/光斑/柔光/侧光/剪影 | 光照控制 |
| `of_type` | 静态/动态/回忆/梦境 | 场景类型 |
| `dialogue_type` | dialogue/thought/shout/whisper/burst/narration/box/caption | **气泡形状自动规划** (8 种) |

**示例输出**:
```json
{
  "camera_angle": "仰视",
  "composition": "对称",
  "mood": "紧张",
  "shot_scale": "特写",
  "lighting": "硬光",
  "of_type": "动态",
  "dialogue_type": "shout"
}
```
↓
```
extreme close-up shot, low angle view, symmetric composition, tense atmosphere, hard lighting, dynamic scene
```

### 💬 对话气泡形状规划 (dialogue_type)

`dialogue_type` 是分镜规划阶段的"语气设计"字段 — LLM 会根据小说原文的语气自动为每个分镜选择最贴合的气泡形状, 体现"喊叫/耳语/心理/拟声"等不同语气氛围。详见 [8 种对话气泡类型](#-8-种对话气泡类型-llm-分镜规划自动选型) 章节。

---

## 🔧 对话气泡本地渲染

本项目采用**图像 API + PIL 分离渲染**架构:图像生成 API 只产出无文字的干净画面,对话文字与气泡由后端 PIL 使用系统中文字体直接叠加,彻底杜绝图像 API 渲染中文时出现的乱码、方框、问号等问题。

### 工作流程

```
[图像 API 阶段 — 只产干净画面]
  分镜 prompt + "NO text, NO speech bubble, NO caption"
  → 图像 API 生成无文字画面
  → 保存到 static/output/

[PIL 叠加阶段 — 后端本地渲染]
  单分镜: /api/generate-image 内部调用 _overlay_bubble_on_segment
    → 加载中文字体 → 按 dialogue_type 派发气泡绘制器
    → 在 panel 右下角绘制气泡 → 覆盖原文件
  整页: /api/generate-page 内部调用 _overlay_bubbles_on_page
    → compute_grid_layout 计算每个 panel 位置
    → 逐个 panel 叠加气泡 → 覆盖原文件
```

### 关键设计

| 设计点 | 说明 |
|--------|------|
| **API 不渲染文字** | 图像生成 prompt 末尾强制追加 "NO text, NO speech bubble, NO caption, NO dialogue" |
| **后端自动叠加** | PIL 叠加在 `/api/generate-image` 和 `/api/generate-page` 内部完成,前端无感知 |
| **中文字体回退** | msyh.ttc(微软雅黑) → simhei.ttf(黑体) → simsun.ttc(宋体) → Noto CJK → PingFang → arial → default |
| **气泡类型派发** | BUBBLE_DRAWERS 字典支持 dialogue/thought/shout/whisper/burst/narration/box/caption 八种 (LLM 分镜规划阶段自动选, 也可手动改; 详见"8 种对话气泡类型") |
| **文字自适应** | fit_text_to_box 自动折行+缩字号,长对话也能塞进气泡 |
| **整页网格对齐** | PIL 叠加时使用与 prompt 相同的 rows×cols 网格布局计算 panel 位置 |
| **拼版不重复叠加** | `/api/combine-page` 只做网格拼版+页码,不重复画气泡(分镜图已有气泡) |

### 与旧方案对比

| 维度 | 旧方案(图像 API 直渲) | 新方案(PIL 本地渲染) |
|------|----------------------|---------------------|
| 文字渲染 | 图像 API 直接生成中文文字 | 后端 PIL 用系统中文字体绘制 |
| 乱码风险 | 高(API 渲染中文易乱码) | 零(系统字体直渲) |
| 修复流程 | 需调图像 API 重画 | 无需修复,天生干净 |
| 气泡类型 | 受 API 理解力限制 | 4 种类型精确控制 |
| 性能 | 多一次 API 调用 | 本地 PIL 毫秒级 |

### 旧图迁移

历史作品的分镜图/整页图若是旧架构(图像 API 直渲文字)产物,仍会保留原乱码文字。要获得干净气泡,在**分镜管理** Tab 中对相应分镜点击「生成图片」重新生成即可,新图片会自动走 PIL 叠加流程。

---

## 💾 作品保存与导入

### 数据持久化机制

每个账号的作品数据保存在:
```
static/users/<username>/works/<work_id>/
├── meta.json          # 作品元信息(标题/创建时间/修改时间)
├── state.json         # 作品完整状态(分镜/角色/图片映射)
└── images/            # 作品所有图片
    ├── char_<timestamp>.png         # 角色人设图
    ├── comic_page_<N>_seg_<M>_<ts>.png  # 分镜图
    ├── comic_page_<N>_full_<ts>.png     # 整页图
    └── combined_<N>_<ts>.png            # 拼版图
```

### 自动保存

- 每次生成分镜/图片/拼版后自动保存
- 角色分析完成后自动保存
- 切换 Tab 时自动保存

### 加载历史

加载历史作品时,后端会**自动重建图片 URL 映射**:
- 从 `images/` 目录扫描所有图片
- 按命名规则匹配角色人设图(支持 `char_<idx>.png` 和 `char_<timestamp>.png`)
- 按命名规则匹配分镜图(`comic_page_<N>_seg_<M>_*.png`)
- 按命名规则匹配整页图(`comic_page_<N>_full_*.png`)

即使 `state.json` 损坏或图片映射丢失,也能正确恢复。

### 完整性校验

加载时会在控制台打印数据完整性信息(不弹红色警告):
```
loadHistoryWork integrity (informational): {
  meta: {segment_count: 54, character_count: 2, ...},
  mismatches: []
}
```

---

## 🔌 API 接口

### 认证

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/login` | POST | 管理员登录 |
| `/api/logout` | POST | 退出登录 |
| `/api/check-auth` | GET | 检查登录状态 |

### 核心流程

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/segment` | POST | 小说文本 → 漫画分镜(含角色提取,支持每页分镜数 0=LLM 自由控制) |
| `/api/generate-image` | POST | 单张漫画图像生成 |
| `/api/generate-characters` | POST | 从小说分析角色 |
| `/api/generate-character-image` | POST | 生成角色人设图(自动重试) |
| `/api/generate-page` | POST | 一页完整漫画生成(支持上一页参考图、角色参考图) |
| `/api/combine-page` | POST | 合并分镜为漫画页(分镜图已带气泡,仅做网格拼版+页码) |
| `/api/comic-to-novel` | POST | 漫画图片 → 小说文本 |

### 作品管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/work/start` | POST | 创建新作品 |
| `/api/work/save-state` | POST | 保存作品状态 |
| `/api/history` | GET | 作品历史列表 |
| `/api/history/<work_id>` | GET | 作品详情 |
| `/api/history/<work_id>/load` | POST | 加载作品 |
| `/api/history/<work_id>` | DELETE | 删除作品 |
| `/api/history/<work_id>/rename` | POST | 重命名作品 |

### 配置与工具

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/save-config` | POST | 保存 API 配置 |
| `/api/load-config` | GET | 加载 API 配置 |
| `/api/test-llm` | POST | 测试文本 API 连接 |
| `/api/test-image` | POST | 测试图片 API 连接 |
| `/api/clear-cache` | POST | 清理缓存(结果/图片/参考图) |
| `/api/download` | POST | 代理下载图片 |
| `/api/sync/results` | POST | 同步会话结果到服务器 |
| `/api/results/<type>` | GET | 获取持久化数据 |

---

## 📁 项目结构

```
text2comic/
├── app.py                  # Flask 后端(全部逻辑)
├── requirements.txt        # 依赖库
├── config.json             # 配置模板(不含真实密钥)
├── config.local.json       # 本地 API 配置(git ignored)
├── .env                    # 环境变量:密钥/密码(git ignored)
├── .env.example            # 环境变量模板
├── .gitignore              # Git 忽略规则
├── README.md               # 本文件
├── LICENSE                 # MIT 许可证
├── results/                # 会话级恢复数据(git ignored)
├── templates/
│   ├── index.html          # 主界面
│   └── login.html          # 登录页
├── static/
│   ├── app.js              # 前端交互逻辑
│   ├── cache/              # 参考图缓存(git ignored)
│   ├── output/             # 生成的临时图片(git ignored)
│   └── users/              # 账号作品数据(git ignored)
└── text2comic_github_backup/  # 备份目录(git ignored)
```

---

## 🛠️ 技术栈

- **后端**: Flask + Flask-SocketIO + Python 3.8+
- **前端**: HTML + Tailwind CSS (CDN) + 原生 JavaScript + Socket.IO 客户端
- **实时通信**: Flask-SocketIO (WebSocket,任务进度实时推送)
- **图像处理**: Pillow (Python Imaging Library)
- **API 兼容**: 支持 OpenAI 协议接口(文本 + 图像)
- **环境配置**: python-dotenv(可选,内置 .env 解析器)

---

## ❓ 常见问题

### Q: API 测试失败?
A: 检查 API 地址、Key、模型名称是否正确,确保网络可访问

### Q: 角色分析没有结果?
A: 确保小说内容足够长且有明确的角色描写

### Q: 如何保持角色一致性?
A: 先生成角色人设图 → 分镜时勾选对应角色 → 调整参考强度(建议 0.6–0.8)

### Q: 图片生成很慢?
A: 属正常现象,取决于 API 响应速度,请确保网络连接稳定

### Q: 管理员密码忘了?
A: 查看 `.env` 文件中的 `MANGA_ADMIN_PASSWORD`,或删除 `.env` 重启服务(会自动重新生成)

### Q: 生成的图片对话文字会乱码吗?
A: 不会。本项目采用 PIL 本地渲染架构:图像生成 API 只产出无文字的干净画面,对话文字+气泡由后端 PIL 使用系统中文字体(微软雅黑/黑体/宋体)直接绘制,彻底杜绝图像 API 渲染中文乱码的问题。若历史作品图片仍是旧架构(图像 API 直渲文字)产物,请在分镜管理中重新生成该分镜图即可获得干净气泡。

### Q: 加载历史作品图片丢失?
A: 系统会自动从 `images/` 目录重建图片映射。如果仍有问题:
- 检查作品目录下 `images/` 文件夹是否存在
- 查看浏览器控制台的完整性日志
- 重新保存一次作品

### Q: 如何部署到公网?
A: 
1. 修改 `.env` 中的 `MANGA_ADMIN_PASSWORD` 和 `MANGA_SECRET_KEY`
2. 使用 nginx/gunicorn 反向代理
3. 配置 HTTPS
4. 修改 `app.py` 中的 host 为 `0.0.0.0`

### Q: 批量生成时如何暂停?
A: 点击 **⏸️ 暂停** 按钮,当前分镜生成完成后会暂停,再点 **▶️ 继续** 恢复

### Q: max_tokens 设多少合适?
A:
- 短小说(< 4000 字)→ 12288
- 中等小说(4000–8000 字)→ 32768(默认)
- 长小说(> 8000 字)→ 65536
- 极限场景 → 131072(响应慢)

---

## 🚧 开发计划

- [ ] 支持更多图像 API(Stability AI、Midjourney 等)
- [ ] 支持导出为 PDF
- [ ] 支持批量处理长小说(自动分段)
- [ ] 支持自定义分镜模板 / 手动布局编辑
- [ ] 支持多语言界面
- [ ] 支持协作编辑(多用户)
- [ ] 支持云端存储(OSS/S3)

### ✅ 已完成

- [x] WebSocket 实时进度推送(Flask-SocketIO)
- [x] 对话气泡 PIL 本地渲染(图像 API 只产干净画面,后端 PIL 叠加气泡,彻底杜绝乱码)
- [x] 每页分镜数 LLM 自由控制(0 = 自由,2-8 = 建议)
- [x] 整页生成自动参考上一页(单页/批量都生效)
- [x] 角色管理一键清空功能
- [x] 风格设置迁移到主页(分类预设:日漫/美漫/韩漫/国漫/其他)

---

## 📝 注意事项

### 安全提示
- API Key 保存在 `config.local.json`,已加入 `.gitignore`
- `config.json` 是模板,**不要写入真实密钥**
- 管理员密码存放在 `.env`,首次启动自动生成随机密码
- 生成的图片保存在本地,不​会上传到任何第三方服务器
- `results/`、`static/cache/`、`static/users/` 均已加入 `.gitignore`
- 备份目录 `text2comic_github_backup/` 已加入 `.gitignore`

### 使用建议
- 每次处理 3000–8000 字效果最佳
- 先生成角色人设图,再勾选角色生成分镜,角色一致性更好
- 图片生成时间取决于 API 响应速度
- 分镜效果不理想时,可以在分镜管理中手动编辑
- 内网穿透场景下,建议定期手动保存作品状态

---

## 📜 许可证

[MIT License](LICENSE) — Copyright (c) 2026

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

---

## 🙏 致谢

- 感谢所有开源库的贡献者
- 感谢火山引擎、OpenAI 等 API 提供商
- 感谢所有用户的反馈和建议

---

**祝使用愉快!🎉**
