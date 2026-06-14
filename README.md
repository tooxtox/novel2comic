# 小说⇄漫画 双向转换器

一个强大的 Web 应用，使用大语言模型 + 图像生成 API 将小说内容转换为日式黑白漫画，也支持将漫画图片反向转换为小说文本。

## 功能特性

### ✨ 核心功能
- **智能分镜** — 自动将小说内容分解为漫画分镜，支持结构化镜头语言（视角、构图、情绪、景别、光照、场景类型）
- **黑白漫画生成** — 调用图像生成 API 生成日式黑白漫画风格图像
- **角色管理** — 自动提取小说角色、生成角色人设图、保持角色一致性
- **分镜合并** — 将单页分镜合并为完整漫画页，支持自适应网格布局
- **对话气泡** — 自动为分镜添加对话气泡，支持 4 种类型：普通对话、心理活动、大喊/喊叫、旁白
- **作品历史** — 按账号保存、加载、重命名和删除作品
- **漫画转小说** — 支持将漫画图片批量转换为小说文本（支持视觉 LLM）

### 🎯 特色功能
- **角色参考图** — 生成图像时选择出场角色，保持角色一致性
- **上一页参考** — 生成连续漫画页时可参考上一页风格，保持视觉连贯
- **API 预设** — 支持火山引擎 v3 / 火山引擎 Coding / OpenAI 等多种 API
- **配置灵活** — 支持自定义 API 接口地址、模型名称、负面提示词
- **分镜编辑** — 支持编辑场景描述、对话、镜头类型、视角、构图、情绪等结构化字段
- **内网穿透恢复** — 支持 session 数据持久化，断开后自动恢复
- **越界气泡** — 对话气泡可超出分镜框，布局更灵活

### 🖼️ 4 种对话气泡类型

| 类型 | 样式 | 用途 |
|------|------|------|
| `dialogue` | 圆角矩形 + 尖角尾巴 | 普通对话 |
| `thought` | 云形气泡 + 小圆尾巴 | 心理活动、思考 |
| `shout` | 爆炸/锯齿形 | 大喊、喊叫 |
| `narration` | 朴素矩形（米黄底灰框） | 旁白、叙述 |

## 技术栈

- **后端**: Flask + Python
- **前端**: HTML + Tailwind CSS (CDN) + 原生 JavaScript
- **图像处理**: Pillow (Python Imaging Library)
- **API 兼容**: 支持 OpenAI 协议接口（文本 + 图像）
- **环境配置**: python-dotenv（可选，内置 .env 解析器）

## 快速开始

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

浏览器访问 `http://localhost:2778`

### 4. 首次配置

1. 打开 `http://localhost:2778`，使用管理员账号登录（首次启动会自动生成随机密码，打印在控制台）
2. 进入 **API 配置** Tab，填写 API 地址、Key、模型名称
3. 点击 **保存配置**，内容写入 `config.local.json`
4. 管理员密码和 session 密钥自动写入 `.env` 文件

> **⚠️ 安全提示**: 部署到公网前请修改 `.env` 中的 `MANGA_ADMIN_PASSWORD`

## 使用指南

### 第一步：配置 API

1. 进入 **API 配置** Tab
2. 选择一个预设（火山引擎 v3 / 火山引擎 Coding / OpenAI）
3. 填写 API Key 和模型名称（接入点 ID）
4. 点击 **保存配置**

### 第二步：输入小说

1. 进入 **小说输入** Tab
2. 粘贴小说内容（建议 3000–8000 字）
3. 设置每页分镜数（默认 6）

### 第三步：分析角色（可选但推荐）

1. 进入 **角色管理** Tab
2. 点击 **从小说分析角色**
3. 等待 LLM 分析完成
4. 为每个角色点击 **生成人设图**（基线图，失败自动重试）
5. 后续生成分镜时勾选角色可保持一致性

### 第四步：智能分镜

1. 进入 **小说输入** Tab
2. 点击 **开始智能分镜**
3. 自动跳转到 **分镜管理** Tab
4. 可编辑每个分镜的场景描述、对话、镜头语言字段

### 第五步：生成图像

在 **分镜管理** Tab：
- 勾选出场角色
- **生成图片** — 单张生成
- **批量生成图片** — 全部生成

### 第六步：合并漫画页

1. 进入 **漫画预览** Tab
2. 点击 **合并所有页面**
3. 系统自动完成：自适应网格布局 + 对话气泡 + 页码

### 第七步：查看作品历史

1. 进入 **历史记录** Tab
2. 查看、加载、重命名或删除作品
3. 数据保存在 `static/users/` 目录，重启不丢失

### 第八步：漫画转小说

1. 进入 **漫画转小说** Tab
2. 上传漫画图片（支持批量）
3. 填写视觉 LLM 的 API 地址、Key、模型
4. 生成按页拆分的小说文本

## 配置说明

### API 预设

| 预设 | 说明 | 推荐场景 |
|------|------|----------|
| 火山引擎 v3 | 火山引擎标准 API | 文本分镜推荐 |
| 火山引擎 Coding | 火山引擎 Coding API | 代码处理用 |
| OpenAI 预设 | OpenAI 兼容接口 | 海外 API 使用 |

### 环境变量 (.env)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MANGA_SECRET_KEY` | Flask session 签名密钥 | 自动随机生成 |
| `MANGA_ADMIN_USERNAME` | 管理员用户名 | `admin` |
| `MANGA_ADMIN_PASSWORD` | 管理员密码 | 自动随机生成 |
| `MANGA_LLM_MAX_TOKENS` | LLM 最大输出 token | `32768`（上限 128k） |

### 高级设置

- **每页分镜数** — 默认 6 个（可调 2–16）
- **负面提示词** — 避免不想要的风格（如彩色、模糊）
- **参考强度** — 0–1，控制角色参考图的影响力度
- **越界气泡** — 对话气泡是否可超出分镜框

## 镜头语言映射

LLM 输出的结构化镜头语言字段会自动转换为英文 tag 注入图像生成 prompt：

| 字段 | 中文枚举值 | 作用 |
|------|-----------|------|
| `camera_angle` | 俯视/仰视/平视/斜视/主观视角 | 视角控制 |
| `composition` | 三分法/对称/中心对称/框架式/引导线 | 构图控制 |
| `mood` | 紧张/紫蓝/紫红/暧昧/悲伤/温馨/压抑/恐怖 | 情绪氛围 |
| `shot_scale` | 大远景/远景/全景/中景/近景/特写/大特写 | 景别控制 |
| `lighting` | 硬光/背光/顶光/荧光灯/光斑/柔光/侧光/剪影 | 光照控制 |
| `of_type` | 静态/动态/回忆/梦境 | 场景类型 |

## 项目结构

```
text2comic/
├── app.py                  # Flask 后端（全部逻辑）
├── requirements.txt        # 依赖库
├── config.json             # 配置模板（不含真实密钥）
├── config.local.json       # 本地 API 配置（git ignored）
├── .env                    # 环境变量：密钥/密码（git ignored）
├── .env.example            # 环境变量模板
├── .gitignore              # Git 忽略规则
├── README.md               # 本文件
├── LICENSE                 # MIT 许可证
├── results/                # 会话级恢复数据（git ignored）
├── templates/
│   ├── index.html          # 主界面
│   └── login.html          # 登录页
├── static/
│   ├── app.js              # 前端交互逻辑
│   ├── cache/              # 参考图缓存（git ignored）
│   ├── output/             # 生成的临时图片（git ignored）
│   └── users/              # 账号作品数据（git ignored）
└── text2comic_github_backup/  # 备份目录（git ignored）
```

## API 接口

### 认证

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/login` | POST | 管理员登录 |
| `/api/logout` | POST | 退出登录 |
| `/api/check-auth` | GET | 检查登录状态 |

### 核心流程

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/segment` | POST | 小说文本 → 漫画分镜（含角色提取） |
| `/api/generate-image` | POST | 单张漫画图像生成 |
| `/api/generate-characters` | POST | 从小说分析角色 |
| `/api/generate-character-image` | POST | 生成角色人设图（自动重试） |
| `/api/generate-page` | POST | 一页完整漫画生成（含参考图） |
| `/api/combine-page` | POST | 合并分镜为漫画页（含气泡） |
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
| `/api/clear-cache` | POST | 清理缓存（结果/图片/参考图） |
| `/api/download` | POST | 代理下载图片 |
| `/api/sync/results` | POST | 同步会话结果到服务器 |
| `/api/results/<type>` | GET | 获取持久化数据 |

## 注意事项

### 安全提示
- API Key 保存在 `config.local.json`，已加入 `.gitignore`
- `config.json` 是模板，**不要写入真实密钥**
- 管理员密码存放在 `.env`，首次启动自动生成随机密码
- 生成的图片保存在本地，不会上传到任何第三方服务器
- `results/`、`static/cache/`、`static/users/` 均已加入 `.gitignore`
- 备份目录 `text2comic_github_backup/` 已加入 `.gitignore`

### 使用建议
- 每次处理 3000–8000 字效果最佳
- 先生成角色人设图，再勾选角色生成分镜，角色一致性更好
- 图片生成时间取决于 API 响应速度
- 分镜效果不理想时，可以在分镜管理中手动编辑
- 内网穿透场景下，建议定期手动保存作品状态

### 常见问题

**Q: API 测试失败？**
A: 检查 API 地址、Key、模型名称是否正确，确保网络可访问

**Q: 角色分析没有结果？**
A: 确保小说内容足够长且有明确的角色描写

**Q: 如何保持角色一致性？**
A: 先生成角色人设图 → 分镜时勾选对应角色 → 调整参考强度（建议 0.6–0.8）

**Q: 图片生成很慢？**
A: 属正常现象，取决于 API 响应速度，请确保网络连接稳定

**Q: 管理员密码忘了？**
A: 查看 `.env` 文件中的 `MANGA_ADMIN_PASSWORD`，或删除 `.env` 重启服务（会自动重新生成）

## 开发计划

- [ ] 支持更多图像 API（Stability AI、Midjourney 等）
- [ ] 支持上传自定义角色参考图
- [ ] 支持漫画导出为 PDF
- [ ] 支持批量处理长小说（自动分段）
- [ ] 支持自定义分镜模板 / 手动布局编辑
- [ ] 支持多语言界面

## 许可证

[MIT License](LICENSE) — Copyright (c) 2026

## 贡献

欢迎提交 Issue 和 Pull Request！

---

祝使用愉快！🎉
