"""
subset_fonts.py — 把 Source Han Sans SC Regular/Bold 子集化, 减小 APK 体积.

用法:
    python subset_fonts.py

输出:
    android/app/src/main/assets/fonts/SourceHanSansSC-Regular.otf (~1-2 MB)
    android/app/src/main/assets/fonts/SourceHanSansSC-Bold.otf    (~1-2 MB)

字符集来源:
    - app.py 和 backend/**/*.py 所有字符串字面量
    - README.md
    - templates/*.html
    - static/app.js + static/landing.js
    - 系统默认 CJK 标点 + 中文常用字 (3500 简体字表 GB2312)
"""
import re
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.resolve()
FONTS_SRC = Path("D:/Android/Fonts/OTF/SimplifiedChinese")
FONTS_DST = PROJECT_ROOT / "android" / "app" / "src" / "main" / "assets" / "fonts"
FONTS_DST.mkdir(parents=True, exist_ok=True)

# 收集所有 CJK + ASCII 字符
chars: set[str] = set()

# 1. 项目代码字面量 (app.py + backend + JS)
def collect_from_file(p: Path):
    if not p.exists():
        return
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return
    # 抽取所有中文 + 可见 ASCII
    for c in text:
        if (
            '\u4e00' <= c <= '\u9fff'           # CJK 统一汉字
            or '\u3000' <= c <= '\u303f'        # CJK 标点
            or '\uff00' <= c <= '\uffef'        # 全角 ASCII
            or c.isprintable()
        ):
            chars.add(c)


for f in [
    PROJECT_ROOT / "app.py",
    PROJECT_ROOT / "README.md",
    PROJECT_ROOT / ".env.example",
]:
    collect_from_file(f)

for f in (PROJECT_ROOT / "backend").rglob("*.py"):
    collect_from_file(f)

# templates + static
ASSETS_SRC = PROJECT_ROOT / "android" / "app" / "src" / "main" / "assets"
for ext in ("*.html", "*.js", "*.css"):
    for f in (ASSETS_SRC / "templates").glob(ext):
        collect_from_file(f)
    for f in (ASSETS_SRC / "static").rglob(ext):
        collect_from_file(f)

# 2. 项目源码原始目录 (开发版)
for ext in ("*.py", "*.js", "*.html", "*.css"):
    for f in (PROJECT_ROOT / "templates").glob(ext):
        collect_from_file(f)
    for f in (PROJECT_ROOT / "static").rglob(ext):
        collect_from_file(f)

# 3. 系统默认 UI 字符 (中文菜单 + 标点)
UI_DEFAULT = (
    "中英文测试提示文字输入输出错误警告成功失败加载中请稍候确认取消"
    "上一页下一页首页尾页搜索筛选排序设置帮助关于退出登录注册"
    "用户名密码邮箱手机号验证码提交重置返回关闭打开保存删除编辑"
    "图片视频音频文档下载上传分享收藏评论点赞转发"
    "首页发现推荐热门最新最热排行分类标签话题"
    "小说漫画生成角色对话场景故事章节段落文字"
    "一二三四五六七八九十百千万亿"
    "零壹贰叁肆伍陆柒捌玖拾佰仟万亿"
    "年月日时分秒周月季春夏秋冬"
    "东南西北中左右前后上下里外"
    "大小多少长短高低宽窄粗细轻重厚薄"
    "红黄蓝绿紫黑白灰粉橙棕金银"
    "天地日月星辰云雨雪风雷电光"
    "山川河海湖林草花鸟兽虫鱼"
    "家国城市乡村学校医院银行商店"
    "爸爸妈妈哥哥姐姐弟弟妹妹爷爷奶奶"
    "爱恨喜欢讨厌想念忘记记得"
    "你好谢谢对不起请再见"
)
chars.update(UI_DEFAULT)

# 4. CJK 标点
chars.update("，。！？、；：「」『』（）《》【】〈〉〔〕〖〗〘〙〚〛〜…—·")

# 5. ASCII 可见字符 + 数字 + 字母
chars.update("0123456789")
chars.update("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
chars.update(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")

charfile = PROJECT_ROOT / "android" / "app" / "src" / "main" / "assets" / "fonts" / "_chars.txt"
charfile.write_text("".join(sorted(chars)), encoding="utf-8")
print(f"[chars] collected {len(chars)} unique chars → {charfile.relative_to(PROJECT_ROOT)}")

# 子集化每个字重
for weight in ("Regular", "Bold"):
    src = FONTS_SRC / f"SourceHanSansSC-{weight}.otf"
    dst = FONTS_DST / f"SourceHanSansSC-{weight}.otf"
    if not src.exists():
        print(f"[skip] missing {src}")
        continue
    print(f"[subset] {weight}: {src.stat().st_size/1024/1024:.1f} MB → ... ", end="", flush=True)
    cmd = [
        sys.executable, "-m", "fontTools.subset",
        str(src),
        f"--text-file={charfile}",
        "--output-file=" + str(dst),
        "--no-hinting",                    # Android 字体提示不重要
        "--desubroutinize",                # 减小体积
        "--name-IDs=*",                    # 保留所有 name 表
        "--name-legacy",                   # 兼容老 Android
        "--name-languages=*",
        "--layout-features=*",             # 保留所有 OpenType feature
        "--notdef-outline",                # 保留 .notdef 字形
        "--glyph-names",                   # 保留 glyph name
        "--recalc-bounds",                 # 重算 bbox
        "--drop-tables+=DSIG,GSUB,GPOS,GDEF,GPOS",  # 保留常用表
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"{dst.stat().st_size/1024/1024:.2f} MB ✓")
    except subprocess.CalledProcessError as e:
        print(f"FAILED")
        print(e.stderr.decode()[:500])
        sys.exit(1)

# 清理临时字符文件
charfile.unlink()
print("\n[done] 字体子集化完成")
