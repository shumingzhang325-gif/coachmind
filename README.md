# 知练 CoachMind v0.7
## 查明的问题
日志显示所有运算库都加载成功，但识别程序报 “Unable to open zip archive”：仓库里的 pose_landmarker_full.task 已损坏
（开头和大小都对，ZIP 内部结构坏了，典型原因是提交时被当成文本做了换行符转换）。
App 先用了网站上这份坏文件，所以一直没去 Google 取好的。
## 修复
- 模型下载、缓存、导入都检查完整的 ZIP 结构，坏文件直接跳过并说明原因
- 识别程序说模型打不开时，自动换下一个来源（不再把同一个坏文件试几十遍）
- 成功后把好的模型存进手机，以后离线可用
- 新增 .gitattributes，防止 .task / .wasm 再被换行符转换改坏
## 部署
覆盖上传：index.html app.js engine.js coach.js cover.js sw.js manifest.webmanifest icon-*.png，以及 .gitattributes
