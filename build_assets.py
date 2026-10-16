"""
build_assets.py — 一键同步 d:\\text2comic\\ 资源到 android/app/src/main/

用法:
    python build_assets.py            # 默认同步所有
    python build_assets.py --clean    # 同步前清空 android/app/src/main/{python,assets}
    python build_assets.py --embed-config  # 将当前有效配置内置为 APK 默认配置

同步内容:
    app.py                  → android/app/src/main/python/app.py
    backend/                → android/app/src/main/python/backend/
    requirements.txt        → android/app/src/main/python/requirements.txt
    templates/              → android/app/src/main/assets/templates/
    static/                 → android/app/src/main/assets/static/  (过滤 runtime dirs)
    config.example.json     → android/app/src/main/assets/config.json
                              (--embed-config 时使用本地私有配置)
    .env.example            → android/app/src/main/assets/.env.example

过滤规则 (来自 pyinstaller spec + Android 适配需求):
    - 跳过 static/output/, static/cache/, static/users/  (运行时数据)
    - 跳过 templates/comic_page_full_1.png  (1.2 MB 冗余占位图)
    - 跳过 __pycache__/, *.pyc, .DS_Store
"""
import argparse
import shutil
import sys
from pathlib import Path
from localize_assets import patch_templates

PROJECT_ROOT = Path(__file__).parent.resolve()
ANDROID_SRC = PROJECT_ROOT / "android" / "app" / "src" / "main"
ASSETS = ANDROID_SRC / "assets"
PYTHON_DIR = ANDROID_SRC / "python"

# 运行时数据目录 (不能打包进 APK, 否则会和用户数据冲突)
SKIP_DIRS = {
    "output", "cache", "users", "__pycache__", ".git", "node_modules",
    ".gradle", "build", ".idea", ".claude", ".trae", ".pai",
}

SKIP_FILES = {
    "comic_page_full_1.png",  # templates 里的 1.2 MB 冗余图
    ".DS_Store", "Thumbs.db",
}

# 不打包的运行时配置 (每个用户首次启动时由 app.py 自动生成)
SKIP_RUNTIME_FILES = {
    "config.local.json",  # 用户私有 API key
}

# Chaquopy 启动引导模块 (内容内联在此, 不作为独立文件存在于项目里).
#
# 为什么需要它: Android 端拿不到 logcat, 而 Flask 侧一旦 import 失败,
# Java 侧只能拿到一句干巴巴的异常. 让 Python 自己把完整 traceback 写进
# 文件, MainActivity 再把文件内容显示到屏幕上, 用户截图即可反馈.
#
# 关键: 这里必须在 Python 模块里做 import, 不能从 Kotlin 侧用 exec() 硬跑代码.
# Chaquopy 的 PyObject.call 是从 C 层发起, 没有 Python 调用帧, CPython 13 会抛
# "SystemError: frame does not exist".
BOOTSTRAP_PY = '''"""Chaquopy 启动引导: 接管 stdout/stderr, 并安全地 import app 模块.

由 MainActivity.startFlask() 通过 callAttr("setup", log_path) 调用.
"""
import sys
import time
import traceback


def setup(log_path, resource_dir, files_dir):
    """接管 stdout/stderr, 告知 app.py 资源目录, 然后 import app.

    resource_dir / files_dir 由 MainActivity.prepareResourceDir() 传入:
    APK assets 里的 templates/ static/ fonts/ 已经被解压成真实文件放在
    resource_dir 下 —— Chaquopy 的 AssetFinder 只管 .pyc, 看不到 assets/,
    不解压的话 Flask 会报 jinja2.exceptions.TemplateNotFound。

    import 失败时把完整 traceback 写进日志再抛出, 这样 Java 侧展示的
    错误页里就带着真正的原因, 而不是一句 "module not found".
    """
    import os

    os.environ["T2C_RESOURCE_DIR"] = resource_dir
    os.environ["T2C_FILES_DIR"] = files_dir

    stream = open(log_path, "a", encoding="utf-8", buffering=1)
    sys.stdout = stream
    sys.stderr = stream

    stream.write("\\n--- app start %s ---\\n" % time.strftime("%Y-%m-%d %H:%M:%S"))
    stream.write("resource_dir = %s\\n" % resource_dir)
    stream.flush()

    try:
        import app
    except BaseException:
        traceback.print_exc(file=stream)
        stream.flush()
        raise

    return "ok"
'''


def clean():
    """清空同步目标目录 (保留子目录结构)"""
    for d in (ASSETS, PYTHON_DIR):
        if not d.exists():
            continue
        for child in d.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    print(f"[clean] cleared {ASSETS} and {PYTHON_DIR}")


def _copy_tree_filtered(src: Path, dst: Path, base_skip=None):
    """递归拷贝, 跳过 SKIP_DIRS / SKIP_FILES"""
    skip = (base_skip or set()) | SKIP_DIRS
    if not src.exists():
        print(f"[skip] missing: {src}")
        return
    dst.mkdir(parents=True, exist_ok=True)
    for child in src.iterdir():
        if child.name in skip or child.name in SKIP_FILES or child.suffix == ".pyc":
            continue
        if child.is_dir():
            _copy_tree_filtered(child, dst / child.name, skip)
        else:
            shutil.copy2(child, dst / child.name)


def sync(embed_config=False):
    ASSETS.mkdir(parents=True, exist_ok=True)
    PYTHON_DIR.mkdir(parents=True, exist_ok=True)

    # 1. app.py
    src = PROJECT_ROOT / "app.py"
    dst = PYTHON_DIR / "app.py"
    if not src.exists():
        sys.exit(f"[error] app.py not found at {src}")
    shutil.copy2(src, dst)
    print(f"[copy] {src.name} → {dst.relative_to(PROJECT_ROOT)}")

    # 后端模块与入口一起同步, Chaquopy 会收集该目录下的 Python 包.
    src = PROJECT_ROOT / "backend"
    dst = PYTHON_DIR / "backend"
    _copy_tree_filtered(src, dst)
    print(f"[copy] backend/ → {dst.relative_to(PROJECT_ROOT)}")

    # 1b. Chaquopy 引导模块 (内容见 BOOTSTRAP_PY)
    dst = PYTHON_DIR / "bootstrap.py"
    if dst.exists():
        print(f"[keep] bootstrap.py → {dst.relative_to(PROJECT_ROOT)}")
    else:
        dst.write_text(BOOTSTRAP_PY, encoding="utf-8")
        print(f"[gen] bootstrap.py → {dst.relative_to(PROJECT_ROOT)}")

    # 2. requirements.txt (Chaquopy 自己读这个装 pip 包)
    src = PROJECT_ROOT / "requirements.txt"
    dst = PYTHON_DIR / "requirements.txt"
    if src.exists():
        shutil.copy2(src, dst)
        print(f"[copy] {src.name} → {dst.relative_to(PROJECT_ROOT)}")

    # 3. templates/
    src = PROJECT_ROOT / "templates"
    dst = ASSETS / "templates"
    _copy_tree_filtered(src, dst)
    # 每次同步最新模板后重新本地化, 避免旧 HTML 缺少 CSRF token 等更新.
    patch_templates()
    print(f"[copy] templates/ → {dst.relative_to(PROJECT_ROOT)}")

    # 4. static/ (过滤 runtime dirs)
    src = PROJECT_ROOT / "static"
    dst = ASSETS / "static"
    _copy_tree_filtered(src, dst)
    print(f"[copy] static/ → {dst.relative_to(PROJECT_ROOT)}")

    # 5. 默认只同步无密钥示例; 显式 --embed-config 时才使用私有配置.
    src = PROJECT_ROOT / "config.example.json"
    if embed_config:
        for name in ("config.local.json", "config.json"):
            if (PROJECT_ROOT / name).is_file():
                src = PROJECT_ROOT / name
                break
    dst = ASSETS / "config.json"
    if src.exists():
        shutil.copy2(src, dst)
        print(f"[copy] {src.name} → {dst.relative_to(PROJECT_ROOT)}")

    # 6. .env.example
    src = PROJECT_ROOT / ".env.example"
    dst = ASSETS / ".env.example"
    if src.exists():
        shutil.copy2(src, dst)
        print(f"[copy] {src.name} → {dst.relative_to(PROJECT_ROOT)}")

    print("\n[done] 资源同步完成")
    write_asset_manifest()


MANIFEST_NAME = "asset_manifest.txt"   # 不能以 "." 开头: aapt 会静默丢弃点开头的 assets 文件


def write_asset_manifest():
    """生成 assets 完整文件清单, 供 Android 端确定性解压.

    为什么需要: 运行时用 AssetManager 区分"文件/目录"在真机上不可靠 ——
    open(目录) 未必抛异常, list(文件) 在 Android 16 又返回空数组而非 null,
    两种判据都会让子目录 (static/dist、js、fonts...) 丢失, 页面 404 且
    switchTab is not defined. 与其猜, 不如在构建期把清单写死.
    """
    if not ASSETS.exists():
        return
    lines = []
    for path in sorted(ASSETS.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ASSETS).as_posix()
        if rel == MANIFEST_NAME:
            continue
        lines.append(rel)
    target = ASSETS / MANIFEST_NAME
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[gen] {MANIFEST_NAME} ({len(lines)} 个文件)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean", action="store_true",
                        help="同步前先清空目标目录")
    parser.add_argument("--embed-config", action="store_true",
                        help="将当前配置（含 API key）内置为 APK 默认配置")
    args = parser.parse_args()

    if args.clean:
        clean()
    sync(embed_config=args.embed_config)


if __name__ == "__main__":
    main()
