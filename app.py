"""Desktop and Android entry points for Text2Comic."""

import os
import threading

from backend.runtime import (
    ADMIN_PASSWORD,
    ADMIN_USERNAME,
    _ADMIN_PASSWORD_JUST_GENERATED,
    _IS_ANDROID,
    app,
)

# Import route modules once; keep the original endpoint names for url_for.
from backend import auth, comic, works, writing, api
from backend.storage import clean_cache, migrate_legacy_output

if not _IS_ANDROID:
    import webbrowser


def run_server():
    """Chaquopy (Android) 入口: 禁用 reloader, threaded 模式, 单进程.
    MainActivity 通过 module.callAttr('run_server') 调用."""
    _HOST = '127.0.0.1'  # 只在 Android 沙盒内访问, 不需要外部网络
    app.run(host=_HOST, port=2778, debug=False, use_reloader=False, threaded=True)


def main():
    clean_cache()
    migrate_legacy_output()
    # 启动横幅: 首次运行时打印随机生成的 admin 密码, 让用户能找到登录凭据
    print('=' * 60)
    print(f'[manga] admin user : {ADMIN_USERNAME}')
    if _ADMIN_PASSWORD_JUST_GENERATED:
        print(f'[manga] admin pass : {ADMIN_PASSWORD}  (随机生成, 已写入 .env)')
        print('[manga] 部署到公网前请修改 .env 中的 MANGA_ADMIN_PASSWORD')
    else:
        print(f'[manga] admin pass : <从 .env 读取>')
    print(f'[manga] secret_key : 来自 .env / os.urandom  (持久化到 .env)')
    print('=' * 60)

    # Android: WebView 自己加载 http://127.0.0.1:2778, 不需要打开系统浏览器
    if _IS_ANDROID:
        # Android 不走 if __name__ 入口 (Chaquopy 用 module.callAttr), 这里仅作完整性
        run_server()
    else:
        # Windows dev / PyInstaller: 自动打开浏览器 (debug 模式 reloader 会 fork 子进程,
        # 仅子进程打开避免重复); threaded=True 让长任务不阻塞 WebView 心跳
        def _open_browser_delayed():
            url = 'http://127.0.0.1:2778'
            print(f'[manga] opening browser: {url}')
            try:
                webbrowser.open(url)
            except Exception as e:
                print(f'[manga] auto-open browser failed: {e}; please visit {url} manually')

        if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
            threading.Timer(1.5, _open_browser_delayed).start()

        app.run(host='0.0.0.0', port=2778, debug=True, threaded=True)


if __name__ == '__main__':
    main()
