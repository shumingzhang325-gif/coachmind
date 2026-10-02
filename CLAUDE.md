# 知练 CoachMind — 项目交接说明

AI 运动科学教练系统。第一阶段是手机 Web App（GitHub Pages + iPhone Safari“添加到主屏幕”），用手机摄像头视频做姿态分析，并管理运动员档案与训练计划。
开发者：张书铭（Shuming），运动训练专业。用户界面全部用中文；回复用户也用中文。用户用 iPhone 16 Pro 测试，没有 Mac。

线上地址：https://shumingzhang325-gif.github.io/coachmind/
当前版本：v2.1（Service Worker 缓存名 coachmind-v20，每次发布都要加 1）

## 文件
- index.html：全部界面与样式（CSS 在 <style> 里，后面的规则覆盖前面的：依次是基础、皇家黑金、杂志封面风格）
- app.js：主程序：视频读取、逐帧识别、选人跟踪、标定、结果页、IndexedDB 存储、运动员与计划界面
- engine.js：分析算法（头部内嵌 CM_THRESHOLDS 与 CM_CARDS）。源码在 dev/engine_src.js，改源码后把 engine.js 头部（阈值与知识卡）+ engine_src.js 拼回去
- coach.js：速度模型、七维画像、多学科分析、周期计划（短跑 + 5 个项群计划库 GROUP_PLANS）、每日状态。v2.1 计划：从档案 planStart 固定起点按日期推进；opts.focus 来自 brain.js；按年龄（birthYear）、训练年限（trainingYears）、伤病（injuries: [{part, status: current|history}]）改写内容；adjustDay 按当天打卡降强度；loadCheck 自检急性/慢性负荷比 ≤ 1.3，阶段切换自动“过渡周”
- brain.js：大脑（v2.1）：鉴别诊断。observationsFromRecords 把视频（用当前带误差的规则重新判断）、实时捕捉记录转成观察；reason 用 RULES（现象 → 可能原因先验 → 鉴别证据）算出各能力的分数和可信度，输出训练重点、推理链、还不能确定的、需要的测试、安全提醒。教练“不认同”的结论排除
- hrload.js：心率负荷（v2.1）：心率区间、Edwards TRIMP、读取 TCX/GPX/CSV、sRPE 与心率负荷对照提示。为接入手表准备
- docs/AUDIT.md：v2.1 审查报告（审查标准、误差随帧率、发现的问题与修复、局限、手表接入路线）
- sports.js：项目技术库（按项群训练理论：速度性/快速力量性/耐力性/表现难美性/隔网对抗性/同场对抗性，11 个项目）。每个技术有 principles 字段，链接到知识库的原理
- knowledge.js：知识库宏观框架（v2.0）：18 条原理（生物力学/运动生理/训练学/运动学习，每条有规律、原因、在哪体现、怎么测、适用边界、证据等级、文献）+ 训练闭环（模型→测量→诊断→处方→改善→复测）+ 测量可靠性表 + 争议（正方/反方/我们的做法）。文献只能引用 coach.js REFS 里已核对的条目
- live.js：实时动作捕捉的纯计算（v2.0）：关节角度、One-Euro 去抖、视角检查、人体比例与“锁定”过滤、次数状态机、5 个动作（深蹲、深蹲·正面、反向纵跳、原地高抬腿、单腿站立）的指标与错误规则。阈值在 TH，需教练校准。界面在 app.js 的“实时动作捕捉”一节
- img/opening.mp4、img/opening-poster.jpg：开屏与首页封面用的实拍视频（用户提供的 F1 车手片段，原片 1206×670/60fps，用 Real-ESRGAN realesr-general-x4v3 逐帧放大到 1920×1068，按 30fps 输出成 2 倍慢动作，约 7 秒，结尾淡出）。v1.6 起 cover.js（程序生成的日出田径场）已删除
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
7. 视频不要让 <video> 直接请求（Safari 对 Service Worker 返回的视频分段请求经常播放失败，v1.6 真机上开屏变成静帧）。app.js 的 videoUrl() 先用 fetch 整段下载成 blob，再把 blob 地址给 <video>；Service Worker 按普通文件缓存，离线也能播。
8. GitHub Pages 让浏览器缓存页面 10 分钟：sw.js 取 html/js 时用 cache: "no-cache" 向服务器确认，发布后刷新就是新版。
9. 只露出半身时，MediaPipe 会把看不见的腿“猜”在画面里，可见度还有 0.9 以上（v2.0 用 F1 视频做假摄像头时发现：数出了不存在的深蹲）。live.js 用人体比例、躯干 < 80°、连续 6 帧合理才锁定来过滤；画面外的点可见度置 0。不要只靠 visibility 判断。
10. 实时模式的 lmClock 和视频分析共用，detectForVideo 的时间戳用 max(lmClock+1, performance.now())。
11. 诊断规则必须考虑测量误差（engine.js 的 uncertainty + matchCards）：超出阈值的部分大于误差才确认，否则是“边缘”（hits.borderline）。帧率未知时按 30 fps 保守估计。着地距离误差 = 速度 ÷ 帧率 + 2 cm。测试要同时检查“有问题能报出”和“没问题不误报”。
12. 训练计划不能每次从“今天”重算（v2.0 以前今天永远是第 1 周“一般准备期”）：用档案的 planStart；换目标日期时重设。
13. 大脑的可信度要求来源独立：同一份数据不能算两次（雷达技术分来自视频、恢复分来自打卡）；技术是动作专项的，只在同一动作内互相印证；有直接测量时不再用相关的间接推断。
14. 心率负荷对短跑、力量、跳跃课无效（心率跟不上），这类课以 RPE × 时长为准。iPhone 网页 App 读不到“健康”App 和手表数据，只能导入文件或用快捷指令。

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
- node test_live.js（实时捕捉：合成骨架“表演”已知动作，加噪声和丢帧，检查计数、角度、纵跳高度、错误判断、不误报；含“半身假骨架不计数”回归测试）。改阈值后可把噪声调到 5 px、丢帧 10%，并换几个随机种子再跑一次
- node test_kb.js（知识库：结构完整；正文里的“作者 年份”必须在已核对文献里；技术和实时动作都链接到存在的原理）
- node test_audit.js（视频分析审查：各帧率误差在估计范围内；正常跑不误报、错误跑能报出；边缘结果；帧率未知时保守）
- node test_brain.js（大脑：鉴别诊断方向、证据加权、教练意见优先、来源独立性、规则完整）
- node test_plan.js（计划：周期按日期推进、352 种组合负荷自检、重点进入所有项目、年龄/训练年限/伤病/当天状态）
- node test_hrload.js（心率：区间、TRIMP、TCX/GPX/CSV、各种不可信情况的提示）
- 浏览器端：真实 MediaPipe 运行时在这个仓库的文件里，能联网时用 Playwright + Chromium 做端到端测试（注意用真实运行时，替身测不出 Emscripten 相关问题）。
- 实时捕捉端到端：Chromium 加 --use-fake-device-for-media-stream --use-file-for-fake-video-capture=视频.y4m（ffmpeg 转 y4m）当摄像头。云端容器没有 GPU，只有 1–2 帧/秒，真机速度要在 iPhone 上看。Chromium 不支持 H.264，视频类测试用 VP9 副本。

## 设计规范（用户多次反馈后确定）
- 开屏（v1.6）：全屏实拍视频 + 参考高端网站的排版：左上品牌、右上“跳过”，左下眉题小字 → 大号衬线双行标题（第二行斜体）→ 中文标语 → 白色胶囊按钮“开始训练”，文字逐行升起，底部细线显示进度。每次打开播一次；低电量模式不能自动播放时用静帧慢推。首页封面循环播放同一段视频（压暗）。
- 版权：开屏视频是用户自己选定的 F1 宣传片段（含 Red Bull 等商标），用户已知晓公开使用的版权风险并决定使用；以后如换成自拍或免费可商用素材，只需替换 img/opening.mp4 和 img/opening-poster.jpg。
- 黑色底 + 象牙白文字；金色只做点缀（小标题、细线、按钮细边框）。用户认为大面积金色“土”。
- 字体：标题 Cinzel/Didot，斜体 Cormorant Garamond/Baskerville，中文宋体（Songti SC）。fonts/ 下的开源字体可选。
- 不用网上的受版权保护图片；用户给的照片只是参考，不要直接使用。

## 内容可信度
- 所有文献 DOI 已在 PubMed 核对（Weyand 2000、Haugen 2019、Nagahara 2018、Suchomel 2015、Kipp 2011、Seitz 2014、de Villarreal 2012、Rumpf 2016、Issurin 2010、van Dyk 2019、Gabbett 2016、Jäger 2017、Kreider 2017、Mah 2011）。不要编造文献。
- 阈值、参考目标、训练计划是经验模板，界面上已注明“需教练审核”。

## 待办
- 手表：做 iPhone 快捷指令，一键把当天训练的心率和时长交给 App（详见 docs/AUDIT.md 第五节）。
- 大脑：规则权重是经验值，用研究一（AI vs 资深教练 Kappa）的结果校准；视频诊断结果要用测力台或高速摄像的真实数据确认误差。
- 计划还没考虑：多场比赛的赛历、每次课可用时长与器材、炎热/海拔、教练对单次课的手动修改。
- 实时捕捉：在真机上确认识别帧率；用真实运动员（侧面/正面各拍几组）校准 live.js 的 TH 阈值，并比较实时纵跳高度和 240 帧视频的差异。
- 用真实运动员慢动作视频（iPhone 240fps、三脚架固定机位）验证触地识别；阈值请老师校准。
- 研究一：AI 诊断 vs 3 名资深教练（Kappa 一致性），导出 CSV 已支持。
- fonts/ 下三个开源字体（@fontsource/cinzel、@fontsource/cormorant-garamond）可以补上。

## 发布流程
改完 → 跑测试 → sw.js 缓存名加 1 → 推送分支并开 PR → 用户在手机上合并 → GitHub Pages 自动更新 → 用户在 Safari 下拉刷新。
