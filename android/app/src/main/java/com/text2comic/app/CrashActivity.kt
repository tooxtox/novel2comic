package com.text2comic.app

import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File

/**
 * 崩溃详情页 —— 取代"闪退后什么都看不到".
 *
 * 默认 UncaughtExceptionHandler 捕获到异常后:
 *   1. 把 完整堆栈 + Python 日志尾部 写进 filesDir/last_crash.txt
 *   2. 用本 Activity 把它显示出来 (文本可选中, 用户可截图/复制反馈)
 *   3. 再结束进程
 *
 * 这样即使 App 在设备上崩溃, 屏幕上也会留下可读的原因, 不必再连电脑抓 logcat.
 */
class CrashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val detail = intent.getStringExtra(EXTRA_TEXT)
            ?: runCatching { File(filesDir, FILE_NAME).readText() }.getOrNull()
            ?: "崩溃信息不可用 (未捕获到异常内容)"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFFF7F7F7.toInt())
            setPadding(dp(20), dp(28), dp(20), dp(20))
        }

        root.addView(TextView(this).apply {
            text = "text2comic 启动失败"
            setTextColor(0xFFD32F2F.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 21f)
        })

        root.addView(TextView(this).apply {
            text = "下面是出错详情，长按可复制，请截图反馈给开发者。"
            setTextColor(0xFF555555.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, dp(10), 0, dp(12))
        })

        root.addView(ScrollView(this).apply {
            setBackgroundColor(0xFFFFFFFF.toInt())
            addView(TextView(this@CrashActivity).apply {
                text = detail
                setTextIsSelectable(true)
                setTextColor(0xFF1A1A1A.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                setPadding(dp(12), dp(12), dp(12), dp(12))
            })
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        root.addView(Button(this).apply {
            text = "关闭"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(16) })

        setContentView(root)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_TEXT = "com.text2comic.app.CRASH_TEXT"
        const val FILE_NAME = "last_crash.txt"
    }
}
