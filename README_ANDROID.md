# text2comic Android APK 构建说明

本文档说明如何把 `d:\text2comic\` 打包成全离线 Android APK。

## 架构

```
APK (≈30 MB)
├── Android 系统 WebView      (系统组件, 不计入 APK)
├── MainActivity (Kotlin)     启动 Flask + WebView 加载 127.0.0.1:2778
├── Chaquopy Runtime          Python 3.13 解释器 (≈12 MB)
├── Flask + PIL + requests    用户 Python 代码 (≈8 MB)
└── Assets:
    ├── templates/, static/   Flask 前端
    ├── fonts/                思源黑体子集化 OTF (≈460 KB)
    └── tailwind.css, GSAP    前端静态资源
```

Flask 进程由 Chaquopy 在 daemon 线程中启动，WebView 通过 `http://127.0.0.1:2778` 访问。

## 工具链（一次性安装）

| 组件 | 版本 | 路径 |
|---|---|---|
| JDK | Temurin 17.0.13 | `C:\Android\Jdk17\jdk-17.0.13+11` |
| Android SDK | cmdline-tools 12.0 | `C:\Android\Sdk` |
| Gradle | 8.9 | `C:\Android\Gradle\gradle-8.9` |
| Node.js | (含 npm) | `C:\Program Files\nodejs` |

### 环境变量

```bat
setx JAVA_HOME "C:\Android\Jdk17\jdk-17.0.13+11"
setx ANDROID_HOME "C:\Android\Sdk"
setx PATH "%PATH%;C:\Android\Sdk\cmdline-tools\latest\bin;C:\Android\Sdk\platform-tools;C:\Android\Sdk\build-tools\34.0.0;C:\Android\Gradle\gradle-8.9\bin;C:\Android\Jdk17\jdk-17.0.13+11\bin"
```

## 首次构建（从源码到 APK）

```bash
# 0. 在 d:\text2comic\ 下, 安装 Python 依赖 (用于 build helper 脚本)
pip install fonttools

# 1. 同步 Flask 项目到 android/app/src/main/
#    同步会更新所有模板, 并自动把 CDN 引用替换为本地资源路径。
python build_assets.py

# 默认打包不含密钥的 config.example.json，私有配置和生成的 assets 不提交到 Git。
#    熟人分发版: 内置当前有效配置（优先 config.local.json, 含 API key）。
#    登录后自动加载; 手机上已有保存配置时仍优先使用手机配置。
python build_assets.py --embed-config

# 2. 下载前端 CDN 资源 + 编译 Tailwind (Tailwind 自动从 .html 抽取用到的 class)
python localize_assets.py --download --tailwind --patch
#    首次构建需要下载资源和编译 CSS; 后续同步模板会自动保留本地引用。
#    页面 class 改动后仍需重跑 --tailwind。

# 3. 下载思源黑体并子集化 (压缩 16 MB → 460 KB)
python subset_fonts.py

# 4. 构建 APK
# 注意: 不需要 gradlew wrapper —— `gradle wrapper` 会校验 services.gradle.org
# 分发包地址, 国内网络下必然失败。直接用本地 gradle 构建。
# 也不存在 assembleArm64Debug 任务: abiFilters 只是过滤 ABI, 不产生 product flavor。
#
# ⚠ 必须用 assembleRelease, 不要用 assembleDebug!
#   debug 包带 android:debuggable="true"; 一旦设备上残留
#   「开发者选项 → 调试 → 等待调试器」(Settings.Global wait_for_debugger=1
#   且 debug_app 指向本包, 部分 ROM 还有 vivo_perm_debug_mode),
#   系统会在 onCreate 之前挂起主线程等调试器 —— 应用看起来"打开了"但其实
#   一行代码都没跑, 页面是上一次的残留画面, 点了毫无反应.
#   不可调试的 release 包不会触发这个行为.
cd android
"C:\Android\Gradle\gradle-8.9\bin\gradle" :app:assembleRelease
# 产物: android/app/build/outputs/apk/release/app-release.apk
```

> 仍被卡住时的应急清理（需要 adb 已连接）:
> ```bash
> adb shell settings delete global wait_for_debugger
> adb shell settings delete global debug_app
> ```
> 但根治方式是装 release 包。

## 部署到设备

```bash
# USB 连接手机或启动 Android 模拟器
adb devices

# 安装
adb install -r android/app/build/outputs/apk/release/app-release.apk

# 启动
adb shell am start -n com.text2comic.app/.MainActivity

# 调试日志
adb logcat -s python:V chaquopy:V chromium:E
```

## 关键文件

- [android/build.gradle](android/build.gradle) — 根 Gradle 配置
- [android/app/build.gradle](android/app/build.gradle) — Chaquopy DSL + ABI 过滤
- [android/app/src/main/java/com/text2comic/app/MainActivity.kt](android/app/src/main/java/com/text2comic/app/MainActivity.kt) — 启动 Flask + WebView
- [android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml) — 权限 + 网络配置
- [app.py](app.py) — Flask 启动入口; `backend/` 按运行环境、存储、认证、AI、漫画渲染与业务拆分, `build_assets.py` 同步入口与后端模块

## 排错

| 报错 | 原因 | 处理 |
|---|---|---|
| **CSRF 校验失败，请刷新页面重试** | 旧同步脚本跳过已本地化模板, APK 页面缺少 CSRF token | 运行 `python build_assets.py` 同步最新模板, 重新构建 release APK 并覆盖安装; 同步已改为更新模板后自动本地化 |
| **页面显示正常但什么都点不动** | **debug 包被系统挂起等待调试器**(`wait_for_debugger=1` + `debug_app=本包` + `debuggable`), 主线程在 `onCreate` 前就卡住, 应用其实一次都没真正运行 | 改用 `:app:assembleRelease` 出的不可调试包; 或 `adb shell settings delete global wait_for_debugger` |
| 启动时弹 **"Waiting For Debugger"** 黑色对话框 | 同上 | 同上 |
| **装上一打开就闪退** | **`org.jetbrains.kotlin.android` 插件没 apply, AGP 不编译 `.kt`, `MainActivity` 根本没进 dex → 启动即 `ClassNotFoundException`** | 已在根 `build.gradle` + `app/build.gradle` 补上插件; 见下方"自查" |
| `Test of distribution url ... failed` | `gradle wrapper` 要访问 `services.gradle.org` 校验分发包 | 跳过 wrapper, 直接用本地 `gradle` 命令 |
| `Cannot locate tasks that match ':app:assembleArm64Debug'` | `abiFilters` 不是 product flavor, 没有 arm64 flavor 任务 | 用 `:app:assembleDebug` |
| `Duplicate class kotlin.collections.jdk8.CollectionsJDK8Kt` | Chaquopy 传递 `kotlin-stdlib-jdk7/jdk8:1.6.21`, 与 `kotlin-stdlib:1.8.22` 重复 | 已在 `app/build.gradle` 用 `constraints` 对齐到 1.8.22 |
| `Unresolved reference: runcode` | Chaquopy 17 的 `Python` 类**没有** `runcode()` | 引导逻辑改放 `python/bootstrap.py`, 用 `getModule("bootstrap").callAttr("setup", logPath)` |
| `SystemError: frame does not exist` | 从 Kotlin 用 `getBuiltins().get("exec").call(...)` 跑 Python 代码 —— Chaquopy 从 C 层发起调用, 没有 Python 调用帧, CPython 取不到隐含 globals | 同上, 不要在 Java 侧 exec Python; 必须走真实模块 |
| `app.py` 不在 APK 的 `assets/` 下 | Chaquopy 把 Python 源码编译成 `.pyc` 收进 `assets/chaquopy/app.imy` | 正常, 不是漏打包 |
| `jinja2.exceptions.TemplateNotFound` | **Chaquopy 的 AssetFinder 只管 `.pyc`, Python 侧 `os.path.isfile()` 看不到 `assets/` 里的 `templates/` `static/`** | `MainActivity.prepareResourceDir()` 启动时用 `context.assets` 把它们解压成 `filesDir/res/` 的真实文件, 路径经 `bootstrap.setup()` → 环境变量 `T2C_RESOURCE_DIR` 传给 `app.py` |
| `ModuleNotFoundError: chaquopy.utils` | Chaquopy 17 **没有** `chaquopy.utils` 模块(`copy_asset` / `get_files_dir` 都不存在) | 字体直接 `shutil.copy2` 从解压目录复制; filesDir 由环境变量传入 |
| 首个请求很慢 / 卡在启动页 | 首次启动要解压 ~12 MB static 资源 | 仅首次; 之后按 `lastUpdateTime` 打戳跳过, APK 不更新就不再解压 |
| 页面能打开但元素点不动 / 不显示 | 模板里 `templates/*.html` 仍指向 `cdn.tailwindcss.com`, 离线设备加载不到 | 跑 `python localize_assets.py --tailwind --patch`(必须在 `build_assets.py` 之后) |
| **按钮有按压效果但点了没反应** | **`dist/app.js` 用了设备 WebView 不支持的语法 → 整文件 SyntaxError → 脚本一行不执行 → 内联 `onclick` 全部 ReferenceError** | `scripts/build.mjs` 的 esbuild `target` 必须是 `es2017`; 改完跑 `npm run build` 再 `python build_assets.py` |
| `[error] 'npx' 未找到`(但明明装了 Node) | Windows 上真实可执行文件是 `npx.cmd`, `subprocess` 解析不到裸 `npx` | 已改用 `shutil.which("npx")` |

### 自查: 确认 Activity 真的编进了 dex

Kotlin 插件漏 apply 时构建**不会报错**, 只会安静地产出一个没有 Activity 的包。
每次改动 Kotlin 源码后, 用这个脚本验一下:

```python
import zipfile
apk = r"android\app\build\outputs\apk\release\app-release.apk"
zf = zipfile.ZipFile(apk)
for n in zf.namelist():
    if n.endswith(".dex") and b"Lcom/text2comic/app/MainActivity;" in zf.read(n):
        print("OK MainActivity 在", n)
else:
    print("!! MainActivity 不在 dex —— 检查 Kotlin 插件")
```

### 调试辅助: 本地复现 Android 的资源布局

`_repro_android_assets.py` 让桌面端用 APK 里那套已本地化的 `assets/` 跑 Flask
(模板与 static 都从 assets 读), 端口 2780。这样在浏览器里测到的就是真正发到手机上
的 HTML/CSS/JS, 不用每次都装机。

```bash
python _repro_android_assets.py
# 浏览器打开 http://127.0.0.1:2780/app
```

## 已知限制

1. **首次启动慢**：Chaquopy 启动 + Flask ready 约 5-8 秒
2. **APK 体积 ~30 MB**：Python 解释器是主要部分
3. **CJK 字体子集化**：当前子集只覆盖 1380 个字符（项目代码 + UI 默认字）。如果用户输入生僻字，需要扩展字符集后重新跑 `python subset_fonts.py`
4. **Android 杀进程**：Flask 跟 Activity 同生命周期，按 Home 后系统可能杀进程
5. **商用授权**：Chaquopy 个人非商用免费，商用需购买授权（$4000/年/应用）
