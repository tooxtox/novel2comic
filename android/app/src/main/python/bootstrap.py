"""Chaquopy 启动引导: 接管 stdout/stderr, 并安全地 import app 模块.

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

    stream.write("\n--- app start %s ---\n" % time.strftime("%Y-%m-%d %H:%M:%S"))
    stream.write("resource_dir = %s\n" % resource_dir)
    stream.flush()

    try:
        import app
    except BaseException:
        traceback.print_exc(file=stream)
        stream.flush()
        raise

    return "ok"
