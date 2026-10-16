# Chaquopy / Python 相关
-keep class com.chaquo.python.** { *; }
-keep class org.jnius.** { *; }
-keep class com.text2comic.app.MainActivity { *; }

# AndroidX
-keep class androidx.appcompat.** { *; }
-keep class androidx.core.** { *; }

# 保留行号便于 debug
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# PIL/werkzeug 等关键 Python 模块在 PyObject.call 时不能被混淆
-keepattributes *Annotation*
-keepattributes Signature
