# 知练 CoachMind v0.9

修复：iPhone 上“dbg is not a function”导致识别程序启动失败。
原因：页面里调试面板的 id 叫 dbg，浏览器会把它当成全局变量；识别运行时（Emscripten）调用全局 dbg() 输出调试信息时拿到的是这个元素。已改名，并提前提供真正的 dbg 函数。

部署：覆盖上传 index.html app.js sw.js（其余文件与 v0.8 相同，一起覆盖也可以）
