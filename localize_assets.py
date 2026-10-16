"""
localize_assets.py — 把前端 CDN 依赖本地化, 供离线 APK 使用.

用法:
    python localize_assets.py              # 默认只本地化 (前提: 已有下载)
    python localize_assets.py --download   # 从 Google Fonts / jsdelivr 下载 woff2 / JS
    python localize_assets.py --tailwind   # 用 npx tailwindcss 编译 CSS (需要 npm)

输出:
    android/app/src/main/assets/static/tailwind.css
    android/app/src/main/assets/static/fonts/noto-sans-sc-*.woff2 + .css
    android/app/src/main/assets/static/js/gsap.min.js + ScrollTrigger.min.js

模板替换 (templates/*.html):
    https://cdn.tailwindcss.com           → /static/tailwind.css
    https://fonts.googleapis.com/...      → /static/fonts/noto-sans-sc.css
    https://cdn.jsdelivr.net/.../gsap...  → /static/js/gsap.min.js
    https://cdn.jsdelivr.net/.../ScrollTrigger.min.js  → /static/js/ScrollTrigger.min.js
"""
import argparse
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.resolve()
STATIC = PROJECT_ROOT / "android" / "app" / "src" / "main" / "assets" / "static"
FONTS_DIR = STATIC / "fonts"
JS_DIR = STATIC / "js"
TEMPLATES = PROJECT_ROOT / "android" / "app" / "src" / "main" / "assets" / "templates"

# Tailwind 入口 (用户侧维护: 列出会用到的 class)
TAILWIND_INPUT = PROJECT_ROOT / "tailwind.input.css"

GSAP_VERSION = "3.12.5"


def ensure_dirs():
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    JS_DIR.mkdir(parents=True, exist_ok=True)


# ===================== 下载 =====================

def fetch_url(url: str, dst: Path):
    """用 curl 下载 (比 urllib 更稳, 处理 SSL/重定向/分块).
    fallback 到 urllib if curl 不存在."""
    print(f"[fetch] {url} → {dst.name}")
    import subprocess
    try:
        result = subprocess.run(
            [
                "curl", "-L", "-s",
                "-H", "User-Agent: Mozilla/5.0",
                "-H", "Accept: */*",
                "--connect-timeout", "30",
                "--max-time", "120",
                "--retry", "2",
                url,
                "-o", str(dst),
            ],
            check=True,
            capture_output=True,
        )
        size = dst.stat().st_size
        print(f"   {size / 1024:.1f} KB (curl)")
        return
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        print(f"   [warn] curl 失败 ({e}), fallback 到 urllib")
    # fallback
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    dst.write_bytes(data)
    print(f"   {len(data) / 1024:.1f} KB (urllib)")


def download_gsap():
    """下载 GSAP 和 ScrollTrigger"""
    for name in ("gsap.min.js", "ScrollTrigger.min.js"):
        url = f"https://cdn.jsdelivr.net/npm/gsap@{GSAP_VERSION}/dist/{name}"
        fetch_url(url, JS_DIR / name)


def download_noto_sans_sc():
    """从 jsdelivr @fontsource 包下载 Noto Sans SC (简体) woff2, 写本地 @font-face CSS.
    比 Google Fonts 稳定 (jsdelivr 国内可达, SSL 不掉)."""
    # @fontsource/noto-sans-sc 5.x 提供简体中文字子集 (chinese-simplified) woff2
    FONT_BASE = "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.0.5/files"
    weights = [400, 700]
    new_blocks = []
    for w in weights:
        fname = f"noto-sans-sc-chinese-simplified-{w}-normal.woff2"
        url = f"{FONT_BASE}/{fname}"
        try:
            fetch_url(url, FONTS_DIR / fname)
        except Exception as e:
            print(f"[warn] woff2 下载失败, fallback 到 ttf: {e}")
            # fallback 到 ttf (Google Fonts)
            ttf_url = (
                "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.0.5/files/"
                f"noto-sans-sc-chinese-simplified-{w}-normal.ttf"
            )
            fetch_url(ttf_url, FONTS_DIR / fname.replace(".woff2", ".ttf"))
            fname = fname.replace(".woff2", ".ttf")
        new_blocks.append(
            f"""@font-face {{
    font-family: 'Noto Sans SC';
    font-style: normal;
    font-weight: {w};
    font-display: swap;
    src: url('/static/fonts/{fname}') format('{fname.split('.')[-1]}');
}}"""
        )

    css_out = "\n".join(new_blocks) + "\n"
    (FONTS_DIR / "noto-sans-sc.css").write_text(css_out, encoding="utf-8")
    print(f"[done] noto-sans-sc.css ({(FONTS_DIR / 'noto-sans-sc.css').stat().st_size} bytes)")


def build_tailwind():
    """用 npx tailwindcss 编译 tailwind.input.css → static/tailwind.css"""
    if not TAILWIND_INPUT.exists():
        TAILWIND_INPUT.write_text(
            """@tailwind base;
@tailwind components;
@tailwind utilities;
""",
            encoding="utf-8",
        )
        print(f"[create] {TAILWIND_INPUT.name}")
    print("[tailwind] 编译中...")
    # Windows 上 npx 实际是 npx.cmd / npx.ps1, 硬编码 "npx" 会让 subprocess
    # 抛 FileNotFoundError —— 必须用 shutil.which 解析真实可执行文件.
    npx = shutil.which("npx")
    if not npx:
        sys.exit("[error] 'npx' 未找到, 请先装 Node.js")
    cmd = [
        npx, "--yes", "tailwindcss",
        "-i", str(TAILWIND_INPUT),
        "-o", str(STATIC / "tailwind.css"),
        "--minify",
        "--content", ",".join([
            str(TEMPLATES / "*.html"),
            str(STATIC / "**/*.html"),
        ]),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        sys.exit("[error] 'npx' 未找到, 请先装 Node.js")
    except subprocess.CalledProcessError as e:
        sys.exit(f"[error] tailwindcss failed:\n{e.stderr}")
    out = STATIC / "tailwind.css"
    if not out.exists():
        sys.exit("[error] tailwind.css 未生成")
    print(f"[done] tailwind.css ({out.stat().st_size / 1024:.1f} KB)")


# ===================== 模板替换 =====================

CDN_REPLACEMENTS = [
    # (pattern, replacement)
    (r'<script\s+src=["\']https://cdn\.tailwindcss\.com["\']\s*></script>',
     '<link rel="stylesheet" href="/static/tailwind.css">'),
    (r'<link[^>]+href=["\']https://fonts\.googleapis\.com/[^"\']+["\'][^>]*/?>',
     '<link rel="stylesheet" href="/static/fonts/noto-sans-sc.css">'),
    (r'<link[^>]+href=["\']https://fonts\.gstatic\.com/[^"\']+["\'][^>]*/?>',
     ''),
    (r'<link[^>]+rel=["\']preconnect["\'][^>]*fonts\.googleapis\.com[^>]*/?>',
     ''),
    (r'<link[^>]+rel=["\']preconnect["\'][^>]*fonts\.gstatic\.com[^>]*/?>',
     ''),
    (r'<script[^>]+src=["\']https://cdn\.jsdelivr\.net/npm/gsap@\d+\.\d+\.\d+/dist/gsap\.min\.js["\'][^>]*></script>',
     '<script defer src="/static/js/gsap.min.js"></script>'),
    (r'<script[^>]+src=["\']https://cdn\.jsdelivr\.net/npm/gsap@\d+\.\d+\.\d+/dist/ScrollTrigger\.min\.js["\'][^>]*></script>',
     '<script defer src="/static/js/ScrollTrigger.min.js"></script>'),
]


def patch_templates():
    """把 templates/ 里所有 CDN 引用替换为本地路径"""
    if not TEMPLATES.exists():
        print(f"[skip] {TEMPLATES} 不存在, 跳过模板替换")
        return
    count = 0
    for html in TEMPLATES.glob("*.html"):
        text = html.read_text(encoding="utf-8")
        new_text = text
        for pat, repl in CDN_REPLACEMENTS:
            new_text = re.sub(pat, repl, new_text, flags=re.IGNORECASE)
        if new_text != text:
            html.write_text(new_text, encoding="utf-8")
            count += 1
            print(f"[patch] {html.name}")
    print(f"[done] patched {count} HTML file(s)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true",
                        help="从 Google Fonts / jsdelivr 下载 woff2 / JS")
    parser.add_argument("--tailwind", action="store_true",
                        help="用 npx tailwindcss 编译 CSS")
    parser.add_argument("--patch", action="store_true",
                        help="替换 templates/ 里的 CDN 引用为本地路径")
    args = parser.parse_args()

    if not any((args.download, args.tailwind, args.patch)):
        args.download = args.tailwind = args.patch = True

    ensure_dirs()

    if args.download:
        download_noto_sans_sc()
        download_gsap()

    if args.tailwind:
        build_tailwind()

    if args.patch:
        patch_templates()

    print("\n[done] 本地化完成")


if __name__ == "__main__":
    main()
