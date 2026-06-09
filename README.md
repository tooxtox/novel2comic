# Text2Comic — 小说转漫画生成器

将小说内容自动转换为漫画分镜脚本，并通过 AI 图像生成 API 绘制黑白漫画风格图片。

## 功能特性

- 📝 **智能分镜** — 调用 LLM API 将小说文本自动拆分为漫画分镜脚本
- 🎭 **角色管理** — 自动提取小说中的角色及其外貌描述，支持生成角色人设图
- 🎨 **单图生成** — 为每个分镜单独生成漫画图片
- 📄 **整页生成** — 支持参考角色人设图和上一页漫画，一次性生成完整一页漫画
- 🔗 **批量生成** — 支持串行批量生成，每页自动参考上一页保持风格一致
- 🖼️ **漫画预览** — 分镜管理和漫画画廊预览
- ⬇️ **一键下载** — 支持批量下载所有生成的图片

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置 API

在 `config.json` 中填写你的 API 信息，或启动后在 Web 界面中配置：

```json
{
  "llm_api_url": "https://api.openai.com/v1/chat/completions",
  "llm_api_key": "your-api-key",
  "llm_model": "gpt-4",
  "img_api_url": "https://api.openai.com/v1/images/generations",
  "img_api_key": "your-api-key",
  "img_model": "dall-e-3",
  "segments_per_page": 4,
  "negative_prompt": "color, blurry, low quality, distorted, ugly"
}
```

> **兼容性**: 支持任何兼容 OpenAI SDK 格式的 API（如火山引擎豆包、DeepSeek、智谱等）。

### 3. 运行

```bash
python app.py
```

访问 http://localhost:2778 即可使用。

### 4. 管理员登录

默认账号密码可在 `app.py` 中通过环境变量配置：

```bash
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=your-password
export FLASK_SECRET_KEY=random-secret-key
```

默认值（仅本地测试用）：
- 用户名: `admin`
- 密码: `changeme`

## 项目结构

```
text2comic/
├── app.py                    # Flask 后端
├── config.json               # API 配置（含敏感信息，已 gitignore）
├── requirements.txt          # Python 依赖
├── templates/
│   ├── index.html            # 主界面
│   └── login.html            # 登录页
├── static/
│   ├── app.js                # 前端逻辑
│   ├── output/               # 生成的图片输出目录
│   └── cache/                # 参考图缓存目录
└── .gitignore
```

## 技术栈

- **后端**: Flask (Python)
- **前端**: Tailwind CSS, Vanilla JS
- **API**: OpenAI SDK 兼容格式（兼容多种 LLM 和图像生成 API）
- **图片处理**: Pillow

## 使用流程

1. **配置 API** — 填写 LLM 和图像生成的 API 地址、密钥和模型
2. **输入小说** — 粘贴小说内容（建议 3000-8000 字）
3. **智能分镜** — LLM 自动分析并生成分镜脚本
4. **角色分析** — 自动提取角色，可生成人设参考图
5. **生成漫画** — 支持逐个生成或整页生成
6. **预览下载** — 在画廊中预览并下载

## 安全说明

- `config.json` 包含 API 密钥，已被加入 `.gitignore`
- 生产环境建议通过环境变量配置管理员凭据和 Flask secret key
- 登录会话基于服务端 session，请确保 secret_key 的安全性
