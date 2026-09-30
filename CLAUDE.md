# 知练 CoachMind — 项目交接说明

AI 运动科学教练系统。第一阶段是手机 Web App（GitHub Pages + iPhone Safari“添加到主屏幕”），用手机摄像头视频做姿态分析，并管理运动员档案与训练计划。
开发者：张书铭（Shuming），运动训练专业。用户界面全部用中文；回复用户也用中文。用户用 iPhone 16 Pro 测试，没有 Mac。

线上地址：https://shumingzhang325-gif.github.io/coachmind/
当前版本：v1.5（Service Worker 缓存名 coachmind-v16，每次发布都要加 1）

## 文件
- index.html：全部界面与样式（CSS 在 <style> 里，后面的规则覆盖前面的：依次是基础、皇家黑金、杂志封面风格）
- app.js：主程序：视频读取、逐帧识别、选人跟踪、标定、结果页、IndexedDB 存储、运动员与计划界面
- engine.js：分析算法（头部内嵌 CM_THRESHOLDS 与 CM_CARDS）。源码在 dev/engine_src.js，改源码后把 engine.js 头部（阈值与知识卡）+ engine_src.js 拼回去
- coach.js：教练大脑：速度模型、七维画像、多学科分析、周期计划（短跑 + 5 个项群计划库 GROUP_PLANS）、每日状态
- sports.js：项目技术库（按项群训练理论：速度性/快速力量性/耐力性/表现难美性/隔网对抗性/同场对抗性，11 个项目）
- cover.js：首页封面：WebGL 程序生成的“日出田径场”（短跑）与竖直光带（举重）。不使用任何照片
- sw.js：离线缓存
- vision_bundle.mjs、vision_wasm_internal.js/.wasm、pose_landmarker_full.task、mp4box.all.min.js：离线识别文件。不要改动、不要用 Git LFS
  - vision_bundle.mjs、vision_wasm_internal.js、vision_wasm_internal.wasm 这 3 个 MediaPipe 文件必须是同一版本（@mediapipe/tasks-vision 0.10.14，与 app.js 的 MP_VERSION 一致）。仓库里的 vision_wasm_nosimd_internal.js/.wasm 也是 0.10.14，app.js 目前不加载它们
  - pose_landmarker_full.task（姿态模型）和 mp4box.all.min.js（视频解析）与 MediaPipe 版本无关
- .gitattributes：*.task、*.wasm、*.jpg、*.woff2 按二进制处理（曾因换行符转换损坏过模型文件）

## 已踩过的坑（不要重犯）
1. 元素 id 不能叫 dbg：浏览器把带 id 的元素当全局变量，MediaPipe 的 Emscripten 运行时会调用全局 dbg()，拿到元素就崩溃（报 dbg is not a function）。app.js 启动时已提供 window.dbg 函数。新加 id 前检查不要与 Emscripten 全局名冲突（dbg、out、err、Module、print 等）。
2. CSS 类名 .bar 已被页头占用，给进度条等加样式不要用 .bar > div。
3. Safari 对 new DataView(fetch 得到的 ArrayBuffer) 会报错，app.js 的 zipCheck 改为按字节读取，不要换回 DataView。
4. 模型文件 .task 是 ZIP：下载、缓存、导入都做完整 ZIP 结构检查；识别程序报 Unable to open zip archive 时自动换下一个来源。
5. MediaPipe VIDEO 模式时间戳必须单调递增：全局 lmClock，选人试探（IMAGE 模式，用 setOptions 切换）与正式分析共用。
6. 国内网络：jsDelivr/Google 常连不上，加载顺序是“本站文件 → npmmirror → jsDelivr → unpkg”；模型是“本机 IndexedDB → 本站 → Google”。

## 分析流程与算法
- 流程：选视频 → 帧率 → 选片段 → 选择运动员（点一下，自动试 6%–100% 大小的框，锁定点击处确实识别到人的最小框）→ 标定（短跑/高翻可选）→ 逐帧分析 → 结果。
- 跟踪：裁剪运动员周围区域放大到 512px 识别；按“上一帧位置 + 速度”预测选人，两人交叉时不更新速度（避免跟到旁观者）。
- 重复帧检测（256×144 变化像素计数）：>20% 重复 → 判定为屏幕录制/网络视频，改按文件真实帧率计算并提示。
- 短跑触地：两种方法都跑、取更可信的：①水平静止法（固定机位更精确）；②“最低点静止”法（跟拍、斜向跑也能用）。另有摆腿周期法测步频。手动标记只在自动识别不足时出现。
- 左右腿标签互换自动纠正（unswapLegs）。
- 通用动作分析（任何项目）：关节角度曲线 + 跳跃检测（腾空时间法 h = g·t²/8）+ 技术要点检查清单。

## 测试（改动后必须跑）
- 在 dev 目录里运行（cd dev）：node test_engine.js（合成短跑与高翻）
- node test_jump.js（合成跳跃，腾空 0.5 s → 约 30.7 cm）
- node test_pan.js（跟拍、斜向、30/60/240 fps 触地识别）
- 浏览器端：真实 MediaPipe 运行时在这个仓库的文件里，能联网时用 Playwright + Chromium 做端到端测试（注意用真实运行时，替身测不出 Emscripten 相关问题）。

## 设计规范（用户多次反馈后确定）
- 首页：杂志封面式。开场即封面：凌晨四点朦胧蓝（不要全黑）→ 太阳在跑道消失点升起 → 红色跑道、白色分道线、绿色草坪形成对比 → 标题浮现。
- 黑色底 + 象牙白文字；金色只做点缀（小标题、细线、按钮细边框）。用户认为大面积金色“土”。
- 字体：标题 Cinzel/Didot，斜体 Cormorant Garamond/Baskerville，中文宋体（Songti SC）。fonts/ 下的开源字体可选。
- 不用网上的受版权保护图片；用户给的照片只是参考，不要直接使用。

## 内容可信度
- 所有文献 DOI 已在 PubMed 核对（Weyand 2000、Haugen 2019、Nagahara 2018、Suchomel 2015、Kipp 2011、Seitz 2014、de Villarreal 2012、Rumpf 2016、Issurin 2010、van Dyk 2019、Gabbett 2016、Jäger 2017、Kreider 2017、Mah 2011）。不要编造文献。
- 阈值、参考目标、训练计划是经验模板，界面上已注明“需教练审核”。

## 待办
- 用真实运动员慢动作视频（iPhone 240fps、三脚架固定机位）验证触地识别；阈值请老师校准。
- 研究一：AI 诊断 vs 3 名资深教练（Kappa 一致性），导出 CSV 已支持。
- fonts/ 下三个开源字体（@fontsource/cinzel、@fontsource/cormorant-garamond）可以补上。

## 发布流程
改完 → 跑测试 → sw.js 缓存名加 1 → 推送分支并开 PR → 用户在手机上合并 → GitHub Pages 自动更新 → 用户在 Safari 下拉刷新。
