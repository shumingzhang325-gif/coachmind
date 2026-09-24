# 知练 CoachMind v0.8
## 修复
- iPhone 上“Expected ArrayBuffer for the first argument”：模型检查改为逐字节读取，Safari 可用
- App 自身程序错误不再被误报成“识别程序启动失败”
## 新增
- 开场动画：分道线绘出 → 红色终点线扫过揭示“知练” → 计时读数 → 融入封面（每次打开只播一次，可点击跳过）
- 项目技术库（按项群训练理论）：短跑、跳远、举重、中长跑、体操、跳水、排球、羽毛球、网球、篮球、足球
  每项技术：技术环节 → 关键技术点 → 常见错误（视频里怎么看 / 技术原因 / 身体原因 / 纠正练习 / 伤病风险）
- 通用动作分析：任何项目都能用——骨骼回放、关节角度曲线、自动检测跳跃并按腾空时间计算高度
- 技术要点检查：分析结果里按该技术的关键点逐条判断“达标/待改进”，随记录保存
## 部署
上传/覆盖：index.html app.js engine.js coach.js cover.js sports.js sw.js manifest.webmanifest icon-180.png icon-192.png icon-512.png .gitattributes
（sports.js 是新增文件）
