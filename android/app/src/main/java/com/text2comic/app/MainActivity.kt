package com.text2comic.app

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.os.Process
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ConsoleMessage
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.system.exitProcess

/**
 * 启动 Flask 后端 (127.0.0.1:2778) 并在 WebView 中渲染 Flask 页面.
 *
 * 加固要点 (针对 Android 15 闪退):
 *   1. installCrashHandler() —— 全局兜底, 任何未捕获异常都落盘 + 弹 [CrashActivity],
 *      不再出现"一点就闪退、什么都没有"的黑箱。
 *   2. Python 的 stdout/stderr 重定向到 files/python.log, 并用 try/except 包住
 *      `import app`, 保证 Python 侧的完整 traceback 能被读到 (而不是只有一句
 *      Java 侧的 "module not found")。
 *   3. 用 WindowCompat.setDecorFitsSystemWindows 取代已在 API 30 废弃的
 *      FLAG_LAYOUT_NO_LIMITS; 移除已废弃的 WebSettings.setDatabaseEnabled。
 *   4. onBackPressed 改用 OnBackPressedCallback (API 33 起 onBackPressed 已废弃)。
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "text2comic"
        private const val FLASK_PORT = 2778
        private const val FLASK_BASE_URL = "http://127.0.0.1:$FLASK_PORT"
        private const val PING_TIMEOUT_MS = 500
        private const val PING_INTERVAL_MS = 500
        private const val PING_MAX_ATTEMPTS = 60  // 最多 30 秒
        private const val PY_LOG = "python.log"
        private const val RES_DIR = "res"
        private const val MANIFEST = "asset_manifest.txt"
    }

    private lateinit var webView: WebView
    private lateinit var root: FrameLayout
    private lateinit var diagButton: TextView
    private val consoleLines = ArrayList<String>()
    private lateinit var splashContainer: FrameLayout
    private lateinit var splashProgress: ProgressBar
    private lateinit var splashText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 必须最先装: 之后的任何崩溃才有地方落盘
        installCrashHandler()

        // 沉浸式: 内容延伸到状态栏/导航栏 (FLAG_LAYOUT_NO_LIMITS 在 API 30 已废弃)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        val root = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.WHITE)
        }
        this.root = root

        // 启动画面 (WebView 还没 ready 时显示)
        splashContainer = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.WHITE)
        }
        val splashInner = android.widget.LinearLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.CENTER
            }
            orientation = android.widget.LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        splashProgress = ProgressBar(this).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        splashText = TextView(this).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 32 }
            text = "text2comic 启动中…"
            textSize = 16f
            setTextColor(Color.parseColor("#666666"))
        }
        splashInner.addView(splashProgress)
        splashInner.addView(splashText)
        splashContainer.addView(splashInner)
        root.addView(splashContainer)

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            visibility = View.GONE
        }
        root.addView(webView)

        setContentView(root)

        configureWebView()
        configureBack()
        startFlask()
        waitForFlaskAndLoad()
    }

    /**
     * 全局未捕获异常兜底: 写盘 + 展示 + 退出.
     * 有了它, 设备上崩溃时用户能直接把原因截图反馈, 不需要连电脑抓 logcat.
     */
    private fun installCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
                val sb = StringBuilder()
                sb.append("时间: ").append(stamp).append('\n')
                sb.append("设备: ").append(android.os.Build.MANUFACTURER)
                    .append(' ').append(android.os.Build.MODEL).append('\n')
                sb.append("Android: ").append(android.os.Build.VERSION.RELEASE)
                    .append(" (API ").append(android.os.Build.VERSION.SDK_INT).append(")\n")
                sb.append("线程: ").append(thread.name).append("\n\n")
                sb.append(Log.getStackTraceString(throwable))
                appendPythonLog(sb)

                File(filesDir, CrashActivity.FILE_NAME).writeText(sb.toString())
                startActivity(
                    Intent(this, CrashActivity::class.java).apply {
                        putExtra(CrashActivity.EXTRA_TEXT, sb.toString())
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                    }
                )
            } catch (_: Throwable) {
                // 兜底本身失败也别再抛, 交给下面的 kill
            }
            previous?.uncaughtException(thread, throwable)
            Process.killProcess(Process.myPid())
            exitProcess(10)
        }
    }

    /** 把 Python 日志尾部拼进来 —— Flask 侧报错时这是唯一有用的线索 */
    private fun appendPythonLog(sb: StringBuilder, tail: Int = 6000) {
        runCatching {
            val f = File(filesDir, PY_LOG)
            if (f.exists() && f.length() > 0) {
                sb.append("\n\n===== python.log 尾部 =====\n")
                sb.append(f.readText().takeLast(tail))
            }
        }
    }

    private fun configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // databaseEnabled 已废弃 (API 33), 且现代 WebView 的 IndexedDB 已覆盖其用途
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            defaultTextEncodingName = "UTF-8"
            builtInZoomControls = false
            displayZoomControls = false
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val line = "[${msg.sourceId()}:${msg.lineNumber()}] ${msg.message()}"
                Log.w(TAG, "JS: $line")
                runOnUiThread { recordConsole(line, msg.messageLevel() == ConsoleMessage.MessageLevel.ERROR) }
                return true
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                // 内部链接 (127.0.0.1) 始终在 WebView 内打开
                return false
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                diag("页面开始: $url")
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                Log.d(TAG, "Page loaded: $url")
                diag("页面完成: $url")
            }

            /**
             * 资源加载失败 —— 关键: <script src> 404 不会走 onConsoleMessage,
             * 只看控制台会误判成"JS 没报错所以正常". 这里必须单独兜住.
             */
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) return
                diag("资源失败: ${request.url} — ${error.description} (code ${error.errorCode})", true)
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request.isForMainFrame) return
                diag("HTTP ${errorResponse.statusCode}: ${request.url}", true)
            }
        }

        // 长按页面任意处 = 随时打开诊断. 不依赖"是否捕获到错误", 避免再次陷入盲猜.
        webView.setOnLongClickListener {
            openDiagnostics()
            true
        }
    }

    private fun diag(line: String, isError: Boolean = false) {
        Log.d(TAG, "DIAG $line")
        runOnUiThread {
            if (consoleLines.size >= 150) consoleLines.removeAt(0)
            consoleLines.add(line)
            if (isError) showDiagButton()
        }
    }

    private fun openDiagnostics() {
        val ua = runCatching { webView.settings.userAgentString }.getOrDefault("?")
        val header = buildString {
            append("WebView UA: ").append(ua).append("\n")
            append("设备: ").append(android.os.Build.MANUFACTURER)
                .append(' ').append(android.os.Build.MODEL).append('\n')
            append("Android: ").append(android.os.Build.VERSION.RELEASE)
                .append(" (API ").append(android.os.Build.VERSION.SDK_INT).append(")\n\n")
            append("=== 诊断记录 (${consoleLines.size} 条) ===\n")
        }
        startActivity(
            Intent(this, CrashActivity::class.java).apply {
                putExtra(
                    CrashActivity.EXTRA_TEXT,
                    header + consoleLines.joinToString("\n") + "\n\n" + "--- python.log ---\n" +
                        runCatching { File(filesDir, PY_LOG).readText().takeLast(3000) }
                            .getOrDefault("(无)")
                )
            }
        )
    }

    /**
     * 收集 WebView 的 JS 控制台输出.
     *
     * 页面"显示正常但点不动"这类问题 100% 出在这里 (例如 bundle 用了设备 WebView
     * 不支持的新语法 → 整文件 SyntaxError → 内联 onclick 全部 ReferenceError),
     * 但用户看不到 logcat. 所以一旦出现 ERROR 级输出, 就在页面上浮出一个诊断入口,
     * 点开即可看到全部控制台记录, 截图反馈即可定位.
     */
    private fun recordConsole(line: String, isError: Boolean) {
        if (consoleLines.size >= 120) consoleLines.removeAt(0)
        consoleLines.add(line)
        if (isError) showDiagButton()
    }

    private fun showDiagButton() {
        if (::diagButton.isInitialized && diagButton.visibility == View.VISIBLE) return
        if (!::diagButton.isInitialized) {
            diagButton = TextView(this).apply {
                text = "JS 报错"
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                gravity = Gravity.CENTER
                setBackgroundColor(0xCCB71C1C.toInt())
                setPadding(dp(10), dp(6), dp(10), dp(6))
                setOnClickListener { openDiagnostics() }
            }
            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END
            ).apply { topMargin = dp(8); marginEnd = dp(8) }
            root.addView(diagButton, lp)
        }
        diagButton.visibility = View.VISIBLE
    }

    /** onBackPressed() 在 API 33 已废弃, 改用 OnBackPressedDispatcher */
    private fun configureBack() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    /**
     * 把 APK assets/ 下的前端资源解压到 filesDir/res/ 的真实文件.
     *
     * 为什么必须解压: Chaquopy 的 AssetFinder 只负责 .pyc, templates/ 和 static/ 作为
     * APK assets 存在, Python 侧 os.path.isfile() 看不到它们 —— 直接让 Flask 指向
     * assets 会得到 jinja2.exceptions.TemplateNotFound。
     * Jinja2 / send_file 都要求真实路径, 所以这里落盘。
     *
     * 用 lastUpdateTime 做 stamp, APK 升级后才重新解压, 避免每次启动都拷 12 MB。
     */
    private fun prepareResourceDir(): File {
        val dest = File(filesDir, RES_DIR)
        val marker = File(dest, ".stamp")
        val stamp = runCatching {
            packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()
        }.getOrDefault("0")

        if (File(dest, "templates").isDirectory &&
            runCatching { marker.readText() }.getOrNull() == stamp
        ) {
            return dest
        }

        dest.mkdirs()
        extractAssets(dest)
        marker.writeText(stamp)
        return dest
    }

    /**
     * 递归解压 assets 到 filesDir/res/.
     *
     * 完全不靠运行时猜"哪个是文件哪个是目录" —— 那条路在真机上两次都翻车:
     * open(目录) 未必抛异常, 而 list(文件) 在 Android 16 返回空数组而非 null,
     * 结果子目录 (static/dist、js、fonts、showcase) 全部丢失, 页面 404,
     * 内联 onclick 报 "switchTab is not defined".
     * 改为读构建期生成的 .asset_manifest.txt 逐条拷贝, 行为完全确定.
     */
    private fun extractAssets(dest: File) {
        val manifest = try {
            assets.open(MANIFEST).bufferedReader().readLines()
        } catch (e: Exception) {
            Log.e(TAG, "无法读取 $MANIFEST: ${e.message}")
            return
        }
        var ok = 0
        var fail = 0
        for (rel in manifest) {
            val path = rel.trim()
            if (path.isEmpty()) continue
            val out = File(dest, path)
            try {
                out.parentFile?.mkdirs()
                assets.open(path).use { input ->
                    out.outputStream().use { output -> input.copyTo(output) }
                }
                ok++
            } catch (e: Exception) {
                fail++
                Log.e(TAG, "copyAsset failed: $path — ${e.message}")
            }
        }
        Log.d(TAG, "extracted assets: $ok ok, $fail failed, total ${manifest.size}")
    }

    /**
     * 启动 Python 侧.
     *
     * 引导逻辑放在真正的 Python 模块 bootstrap.py 里, 不从 Kotlin 用 exec() 硬跑代码:
     * Chaquopy 的 PyObject.call() 是从 C 层发起的, 没有 Python 调用帧, CPython 取不到
     * 隐含的 globals(), 会抛 "SystemError: frame does not exist"。
     * bootstrap.setup() 负责: 接管 stdout/stderr -> import app -> 失败时写完整 traceback。
     */
    private fun startFlask() {
        try {
            if (!Python.isStarted()) {
                Python.start(AndroidPlatform(this))
            }
            val py = Python.getInstance()

            val resDir = prepareResourceDir()
            val logPath = File(filesDir, PY_LOG).absolutePath
            try {
                py.getModule("bootstrap").callAttrThrows(
                    "setup", logPath, resDir.absolutePath, filesDir.absolutePath
                )
            } catch (e: Throwable) {
                Log.e(TAG, "bootstrap.setup failed: ${e.message}", e)
                showFatal("Flask 启动失败", e)
                return
            }

            val module = py.getModule("app")

            Thread({
                try {
                    Log.d(TAG, "Starting Flask via app.run_server()")
                    module.callAttr("run_server")
                } catch (e: Throwable) {
                    // stderr 已被 bootstrap 重定向到 python.log, traceback 自动落盘
                    Log.e(TAG, "Flask crashed: ${e.message}", e)
                }
            }, "flask-server").apply {
                isDaemon = true
                start()
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to start Python/Flask: ${e.message}", e)
            showFatal("Python 运行时初始化失败", e)
        }
    }

    /** 启动失败: 停在启动页, 把原因 + Python 日志全部显示出来 (可复制) */
    private fun showFatal(title: String, e: Throwable?) {
        val sb = StringBuilder()
        sb.append(title).append('\n')
        if (e != null) sb.append(e.toString()).append('\n')
        appendPythonLog(sb)
        val msg = sb.toString()
        Log.e(TAG, msg)
        runOnUiThread {
            splashProgress.visibility = View.GONE
            splashText.apply {
                text = msg
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                setTextColor(Color.parseColor("#C62828"))
                setTextIsSelectable(true)
                setPadding(dp(16), 0, dp(16), 0)
            }
        }
    }

    private fun waitForFlaskAndLoad() {
        Thread({
            val url = "$FLASK_BASE_URL/"
            var responded = false
            var httpCode = 0
            for (i in 0 until PING_MAX_ATTEMPTS) {
                try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = PING_TIMEOUT_MS
                    conn.readTimeout = PING_TIMEOUT_MS
                    conn.requestMethod = "GET"
                    val code = conn.responseCode
                    conn.disconnect()
                    // 任何 HTTP 响应都说明 Flask 已经在服务了.
                    // 4xx/5xx 是"页面报错"而非"还没启动", 不该继续干等 30 秒.
                    Log.d(TAG, "Flask responded after ${i * PING_INTERVAL_MS}ms (HTTP $code)")
                    responded = true
                    httpCode = code
                    break
                } catch (_: Throwable) {
                    // 还没启动, 继续等
                }
                try {
                    Thread.sleep(PING_INTERVAL_MS.toLong())
                } catch (_: InterruptedException) {
                    return@Thread
                }
            }

            when {
                responded && httpCode in 200..399 -> runOnUiThread {
                    CookieManager.getInstance().flush()
                    webView.loadUrl(url)
                    webView.visibility = View.VISIBLE
                    splashContainer.visibility = View.GONE
                }
                // 有响应但状态码不对: 立刻把 python.log 里的 traceback 显示出来
                responded -> showFatal("Flask 已启动, 但首页返回 HTTP $httpCode", null)
                else -> {
                    Log.e(TAG, "Flask did not respond in ${PING_MAX_ATTEMPTS * PING_INTERVAL_MS / 1000}s")
                    showFatal("Flask 30 秒内未就绪", null)
                }
            }
        }, "flask-pinger").apply {
            isDaemon = true
            start()
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        super.onDestroy()
        // Flask 是 daemon 线程, Activity 销毁时自动结束
    }
}
