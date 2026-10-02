/* 知练 CoachMind 大脑：鉴别诊断 → 训练优先级
   思路和医生看病一样：
   ① 汇总观察：视频诊断、实时捕捉、体能测试、每日状态。每条观察按可靠性打折（测量误差、次数、多久以前、教练是否认同）。
      教练判断为“不认同”的结论直接排除——AI 负责提醒，教练说了算。
   ② 一个现象对应几种可能原因（例如触地偏长：反应力量不足 / 最大力量不足 / 着地过远），先给经验先验。
   ③ 用其他数据证实或排除（例如深蹲已达标 → “力量不足”的可能性下降），算出每个原因的后验比例。
   ④ 把原因归到“能力”（力量、灵活性、稳定……），多个独立来源互相印证才给“高”可信度。
   ⑤ 输出训练优先级：每条都带推理链、可信度、还缺什么数据、怎么复测；两个原因分不开时明确说“还不能确定”。
   规则里的权重都是经验值（需教练校准），不是统计模型；每条规则都链接到 knowledge.js 的原理。 */
(function (root) {
  "use strict";
  const isF = Number.isFinite;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const HALF_LIFE_DAYS = 28, MAX_AGE_DAYS = 120;

  // ---------------- 能力（训练计划的“重点”） ----------------
  const CAPS = {
    speed: { name: "最高速度", principles: ["impulse", "grf"], retest: "30 米行进间跑", addon: "速度：飞跑 3–4×20 米，组间完全恢复" },
    accel: { name: "加速", principles: ["grf", "forcevel"], retest: "30 米站立式起跑", addon: "加速：4–6×20 米起跑加速，强调前几步推地" },
    se: { name: "速度耐力", principles: ["energy"], retest: "100 米或 150 米计时，看后程掉速", addon: "速度耐力：2–3×120 米 @ 90%，组间 8 分钟" },
    strength: { name: "最大力量", principles: ["forcevel", "torque"], retest: "深蹲 1RM 或 3RM（4–6 周后）", addon: "力量补充：深蹲或单腿蹲 3×5，动作质量优先" },
    power: { name: "爆发力", principles: ["forcevel", "impulse"], retest: "立定跳远、纵跳", addon: "爆发力：立定跳远或药球前抛 4×3，每次全力" },
    reactive: { name: "反应力量（快速伸缩）", principles: ["ssc"], retest: "跳深反应力量指数（RSI）、反向纵跳", addon: "反应力量：踝跳、跳绳 3×15，强调触地短而有弹性" },
    tech: { name: "技术", principles: ["feedback", "variability"], retest: "同样机位和帧率复拍视频", addon: "技术：针对诊断问题的分解练习 15 分钟（见“诊断推理”）" },
    mobility: { name: "灵活性（踝、髋）", principles: ["torque", "balance"], retest: "踝背屈靠墙测试 + 实时深蹲复测", addon: "灵活性：弓步推膝（踝背屈）、髋屈伸拉伸 各 2×10，放在热身里" },
    stability: { name: "稳定与落地控制", principles: ["balance", "injury"], retest: "实时单腿站立、深蹲·正面复测", addon: "稳定：单腿站立 3×30 秒、侧桥 3×30 秒、落地定型跳 2×5" },
    aerobic: { name: "有氧基础", principles: ["energy"], retest: "专项计时测试", addon: "有氧：低强度 20–30 分钟，能完整说话的强度" },
    recovery: { name: "恢复", principles: ["recovery", "load"], retest: "每日状态打卡 1–2 周", addon: "恢复：本周减少一次高强度课，换成恢复课" },
  };

  // ---------------- 发现 → 可能原因（先验）→ 鉴别证据 ----------------
  // w：先验权重（同一发现内会归一化）；disc：when(ctx) 成立时把某个原因乘以 factor，并写进推理链
  const below = (ctx, key) => isF(ctx.ratio[key]) && ctx.ratio[key] < 1;
  const atLeast = (ctx, key) => isF(ctx.ratio[key]) && ctx.ratio[key] >= 1;
  const RULES = {
    // 视频诊断（engine.js 的知识卡）
    "SP-01": { label: "途中跑触地偏长", principles: ["impulse", "ssc"],
      causes: [{ cap: "reactive", w: 0.35, why: "快速伸缩能力不足：缓冲后不能马上转为蹬伸" }, { cap: "strength", w: 0.3, why: "最大力量不足：短时间内产生不了足够的力" }, { cap: "tech", w: 0.35, why: "着地位置偏前，先制动再蹬伸" }],
      disc: [
        { when: c => c.has("SP-02"), cap: "tech", factor: 1.8, text: "同时着地点过远：更像技术问题（跨步着地）" },
        { when: c => below(c, "squat"), cap: "strength", factor: 1.6, text: c => `深蹲 ${c.fmtRatio("squat")}，未达目标：力量不足的可能性上升` },
        { when: c => atLeast(c, "squat"), cap: "strength", factor: 0.5, text: c => `深蹲 ${c.fmtRatio("squat")}，已达目标：不太像力量问题` },
        { when: c => below(c, "slj"), cap: "reactive", factor: 1.3, text: c => `立定跳远 ${c.fmtRatio("slj")}，未达目标` },
      ],
      tests: c => [!c.tests.squat && "深蹲 1RM（区分是不是力量不足）", !c.tests.rsi && "跳深 RSI（区分是不是反应力量不足）"] },
    "SP-02": { label: "着地点离身体过远", principles: ["grf", "impulse"], safety: "着地过远会加大腘绳肌负担，是拉伤的危险因素之一",
      causes: [{ cap: "tech", w: 0.6, why: "追求大步幅，缺少摆动腿下压“扒地”" }, { cap: "strength", w: 0.4, why: "腘绳肌离心力量不足，高速下压不下来" }] },
    "SP-03": { label: "途中跑躯干后仰", principles: ["grf", "balance"],
      causes: [{ cap: "tech", w: 0.5, why: "技术习惯：身体姿态意识不足" }, { cap: "stability", w: 0.5, why: "核心稳定不足，躯干控制不住" }] },
    "SP-04": { label: "左右触地时间不对称", principles: ["balance", "injury"], safety: "左右差异可能和伤病史有关，先由队医评估",
      causes: [{ cap: "stability", w: 0.6, why: "单侧力量或稳定性差" }, { cap: "tech", w: 0.4, why: "左右技术不一致" }],
      disc: [{ when: c => c.injuredLowerLimb, cap: "stability", factor: 1.4, text: "有下肢伤病史：两侧能力可能还没恢复对称" }] },
    "CL-01": { label: "高翻第一次拉过早屈臂", principles: ["chain", "forcevel"], causes: [{ cap: "tech", w: 0.8, why: "想用手臂拉杠铃，动力链顺序错误" }, { cap: "strength", w: 0.2, why: "下肢力量不足，用手臂代偿" }] },
    "CL-02": { label: "杠铃最快时伸髋不充分", principles: ["forcevel", "torque"], causes: [{ cap: "power", w: 0.5, why: "三关节伸展的爆发力不足" }, { cap: "tech", w: 0.3, why: "发力时机早，没等到完全伸展" }, { cap: "strength", w: 0.2, why: "最大力量不足" }],
      disc: [{ when: c => below(c, "squat"), cap: "strength", factor: 1.6, text: c => `深蹲 ${c.fmtRatio("squat")}，未达目标` }] },
    "CL-03": { label: "杠铃前向偏移过大", principles: ["torque"], causes: [{ cap: "tech", w: 0.6, why: "杠铃离身体远，路线不对" }, { cap: "strength", w: 0.4, why: "后链力量不足，背部姿势保持不住" }] },
    "GN-01": { label: "落地缓冲不足", principles: ["balance", "injury", "ssc"], safety: "落地僵硬是膝关节受伤的常见危险动作",
      causes: [{ cap: "stability", w: 0.6, why: "离心控制能力不足" }, { cap: "tech", w: 0.2, why: "没有屈髋屈膝缓冲的习惯" }, { cap: "strength", w: 0.2, why: "离心力量不足" }] },
    "GN-02": { label: "起跳前下蹲幅度小", principles: ["ssc"], causes: [{ cap: "tech", w: 0.6, why: "动作节奏不对" }, { cap: "power", w: 0.2, why: "爆发力不足" }, { cap: "reactive", w: 0.2, why: "不会利用拉长—缩短周期" }] },
    // 实时捕捉（live.js 的错误）
    "squat.shallow": { label: "深蹲蹲不够深", principles: ["torque", "balance"],
      causes: [{ cap: "mobility", w: 0.45, why: "踝或髋灵活性受限，蹲不下去" }, { cap: "tech", w: 0.35, why: "动作习惯或不敢蹲" }, { cap: "strength", w: 0.2, why: "力量不足，蹲深了起不来" }],
      disc: [
        // 有踝背屈测试（直接测量）时，不再用“同时脚跟离地”这类间接推断（直接测量优先）
        { when: c => c.has("squat.heel") && !c.ankleKnown, cap: "mobility", factor: 1.8, text: "同时脚跟离地：踝背屈受限的可能性大" },
        { when: c => c.has("squat.lean") && !c.ankleKnown, cap: "mobility", factor: 1.3, text: "同时躯干过度前倾：常见于踝背屈受限" },
        { when: c => isF(c.tests.ankle && c.tests.ankle.value) && c.tests.ankle.value < 10, cap: "mobility", factor: 1.8, text: c => `踝背屈靠墙测试 ${c.tests.ankle.value} cm（< 10 cm，经验值）：灵活性受限` },
        { when: c => isF(c.tests.ankle && c.tests.ankle.value) && c.tests.ankle.value >= 12, cap: "mobility", factor: 0.3, text: c => `踝背屈靠墙测试 ${c.tests.ankle.value} cm：踝灵活性正常（髋灵活性仍可能受限）` },
      ],
      tests: c => [!c.tests.ankle && "踝背屈靠墙测试（区分是不是灵活性问题）"] },
    "squat.lean": { label: "深蹲躯干过度前倾", principles: ["torque"],
      causes: [{ cap: "mobility", w: 0.4, why: "踝背屈受限，只能靠躯干前倾保持平衡" }, { cap: "strength", w: 0.35, why: "股四头肌力量不足，负荷转给髋" }, { cap: "tech", w: 0.25, why: "动作习惯" }],
      disc: [{ when: c => c.has("squat.heel") && !c.ankleKnown, cap: "mobility", factor: 1.6, text: "同时脚跟离地：更像踝背屈受限" },
        { when: c => isF(c.tests.ankle && c.tests.ankle.value) && c.tests.ankle.value >= 12, cap: "mobility", factor: 0.4, text: c => `踝背屈 ${c.tests.ankle.value} cm 正常` }],
      tests: c => [!c.tests.ankle && "踝背屈靠墙测试"] },
    "squat.heel": { label: "深蹲脚跟离地", principles: ["balance", "torque"], causes: [{ cap: "mobility", w: 0.8, why: "踝背屈受限" }, { cap: "tech", w: 0.2, why: "重心偏前" }],
      disc: [{ when: c => isF(c.tests.ankle && c.tests.ankle.value) && c.tests.ankle.value >= 12, cap: "mobility", factor: 0.15, text: c => `踝背屈 ${c.tests.ankle.value} cm 正常：更像重心控制问题` },
        { when: c => isF(c.tests.ankle && c.tests.ankle.value) && c.tests.ankle.value < 10, cap: "mobility", factor: 1.5, text: c => `踝背屈 ${c.tests.ankle.value} cm 受限` }],
      tests: c => [!c.tests.ankle && "踝背屈靠墙测试"] },
    "squat.hipfirst": { label: "深蹲起立时髋先起", principles: ["torque"], causes: [{ cap: "strength", w: 0.55, why: "股四头肌力量不足，把负荷转给髋" }, { cap: "tech", w: 0.45, why: "发力顺序习惯" }],
      disc: [{ when: c => atLeast(c, "squat"), cap: "strength", factor: 0.6, text: c => `深蹲 ${c.fmtRatio("squat")} 已达目标` }] },
    "squatFront.valgus": { label: "深蹲膝内扣", principles: ["balance", "injury"], safety: "膝内扣是膝关节（前交叉韧带、髌股关节）受伤的危险动作",
      causes: [{ cap: "stability", w: 0.6, why: "髋外展、外旋肌群控制不足" }, { cap: "strength", w: 0.25, why: "臀部力量不足" }, { cap: "tech", w: 0.15, why: "动作意识" }] },
    "cmj.stiff": { label: "跳跃落地僵硬", principles: ["balance", "injury", "ssc"], safety: "落地僵硬是膝关节受伤的常见危险动作",
      causes: [{ cap: "stability", w: 0.5, why: "离心控制能力不足" }, { cap: "tech", w: 0.5, why: "没有缓冲习惯" }] },
    "cmj.valgus": { label: "跳跃落地膝内扣", principles: ["balance", "injury"], safety: "落地膝内扣是前交叉韧带受伤的危险动作",
      causes: [{ cap: "stability", w: 0.7, why: "髋部控制不足" }, { cap: "strength", w: 0.3, why: "臀部力量不足" }] },
    "highknee.low": { label: "高抬腿抬不到水平", principles: ["impulse"], causes: [{ cap: "tech", w: 0.4, why: "动作意识" }, { cap: "mobility", w: 0.3, why: "髋屈灵活性不足" }, { cap: "strength", w: 0.3, why: "屈髋肌力量不足" }] },
    "highknee.back": { label: "高抬腿身体后仰", principles: ["balance"], causes: [{ cap: "stability", w: 0.6, why: "核心稳定不足" }, { cap: "tech", w: 0.4, why: "身体姿态意识" }] },
    "balance.pelvis": { label: "单腿站立骨盆下沉", principles: ["balance", "injury"], causes: [{ cap: "stability", w: 0.8, why: "支撑侧臀中肌控制不足" }, { cap: "strength", w: 0.2, why: "髋外展力量不足" }] },
    "balance.sway": { label: "单腿站立晃动大", principles: ["balance"], causes: [{ cap: "stability", w: 0.9, why: "本体感觉与平衡控制不足" }, { cap: "tech", w: 0.1, why: "注意力（眼睛没盯住固定点）" }] },
    "balance.valgus": { label: "单腿支撑膝内扣", principles: ["balance", "injury"], safety: "单腿支撑膝内扣提示膝关节受伤风险",
      causes: [{ cap: "stability", w: 0.7, why: "髋部控制不足" }, { cap: "strength", w: 0.3, why: "臀部力量不足" }] },
  };

  // ---------------- 观察：把训练记录转成统一格式 ----------------
  // 视频：重新用当前规则（带测量误差）判断，旧记录里按旧规则存的结论不直接采信
  function observationsFromRecords(records, opts = {}) {
    const { CM, TH, CARDS, today = new Date() } = opts, out = [], excluded = [];
    for (const r of records || []) {
      const age = (today - new Date(r.date)) / 864e5;
      if (!(age >= -1) || age > MAX_AGE_DAYS) continue;
      const decay = Math.pow(0.5, Math.max(0, age) / HALF_LIFE_DAYS);
      if (r.action === "live") {
        const reps = (r.summary && r.summary.n) || (r.reps || []).length;
        const viewOk = r.summary && isF(r.summary.viewOkRate) ? r.summary.viewOkRate : 1;
        for (const f of r.faults || []) {
          const p = reps ? f.n / reps : 0;
          if (reps < 3 || p < 0.3) continue;                                     // 次数太少或偶尔出现：当作噪声
          const id = `${r.drill}.${f.key}`;
          if (!RULES[id]) continue;
          out.push({ id, source: "live", date: r.date, reliability: clamp(p, 0, 1) * (viewOk < 0.7 ? 0.5 : 1) * decay,
            detail: `实时${r.drillName || ""} ${f.n}/${reps} 次${viewOk < 0.7 ? "（拍摄角度不理想，降权）" : ""}` });
        }
      } else if (r.summary && CM && TH && CARDS) {
        const res = { action: r.action, fps: r.fpsReal || 240, summary: r.summary, contactMethod: r.contactMethod };
        const hits = CM.matchCards(res, TH, CARDS);
        const all = hits.map(h => [h, 1]).concat((hits.borderline || []).map(h => [h, 0.3]));
        for (const [h, rel] of all) {
          if (!RULES[h.id]) continue;
          const v = (r.verdicts || {})[h.id];
          if (v === "disagree") { excluded.push({ id: h.id, date: r.date, text: `${RULES[h.id].label}：教练判断“不认同”，已排除` }); continue; }
          const k = v === "agree" ? 1.3 : v === "test" ? 0.6 : 1;
          out.push({ id: h.id, source: "video", date: r.date, reliability: clamp(rel * k, 0, 1) * decay,
            detail: `视频 ${String(r.date).slice(5, 10)}：${h.symptom_text}${rel < 1 ? "（边缘结果）" : ""}${v === "agree" ? "（教练认同）" : ""}`, verdict: v });
        }
      }
    }
    return { observations: out, excluded };
  }

  // ---------------- 推理 ----------------
  function reason(a, observations, P, opts = {}) {
    const today = opts.today || new Date();
    const tests = (P && P.tests) || {}, tg = (P && P.targets) || {};
    const bw = a.weight_kg;
    const ratio = {
      squat: tests.squat && isF(bw) && tg.squat_ratio ? (tests.squat.value / bw) / tg.squat_ratio : NaN,
      slj: tests.slj && tg.slj ? tests.slj.value / tg.slj : NaN,
    };
    const injuries = (a.injuries || []).filter(x => x && x.part);
    const ctx = {
      tests, ratio, ankleKnown: !!(tests.ankle && isF(tests.ankle.value)), injuredLowerLimb: injuries.some(x => ["hamstring", "knee", "ankle", "hip"].includes(x.part)),
      fmtRatio: k => k === "squat" ? `${(tests.squat.value / bw).toFixed(2)} 倍体重（目标 ${tg.squat_ratio}）` : `${tests[k].value}（目标 ${tg[k]}）`,
      has: id => present.has(id),
    };
    // 同一发现多次出现：噪声或（noisy-OR）合并，次数越多越可信
    const byId = {};
    for (const o of observations) (byId[o.id] = byId[o.id] || []).push(o);
    const present = new Set(Object.keys(byId));
    const findings = Object.entries(byId).map(([id, os]) => {
      const conf = 1 - os.reduce((p, o) => p * (1 - clamp(o.reliability, 0, 0.95)), 1);
      return { id, label: RULES[id].label, conf, n: os.length, sources: [...new Set(os.map(o => o.source))], details: os.map(o => o.detail), rule: RULES[id] };
    }).sort((x, y) => y.conf - x.conf);

    const caps = {};
    const capOf = k => (caps[k] = caps[k] || { key: k, score: 0, sources: new Set(), byMove: {}, why: [], findings: [], sessions: 0 });
    // 动作：视频卡片按前缀（SP 短跑、CL 高翻、GN 通用），实时按动作名。技术是动作专项的，只能在同一个动作内互相印证
    const moveOf = id => id.includes(".") ? id.split(".")[0] : ({ SP: "sprint", CL: "clean", GN: "general" })[id.slice(0, 2)] || id;
    const undecided = [], tests_needed = new Set(), cautions = [];
    for (const f of findings) {
      const R = f.rule;
      // 后验：先验 × 鉴别证据，归一化
      const post = R.causes.map(c => ({ ...c, p: c.w, notes: [] }));
      for (const d of R.disc || []) {
        let hit = false; try { hit = !!d.when(ctx); } catch (e) { hit = false; }
        if (!hit) continue;
        const c = post.find(x => x.cap === d.cap); if (!c) continue;
        c.p *= d.factor; c.notes.push(typeof d.text === "function" ? d.text(ctx) : d.text);
      }
      const sum = post.reduce((s, c) => s + c.p, 0) || 1;
      post.forEach(c => { c.p /= sum; });
      post.sort((x, y) => y.p - x.p);
      f.causes = post;
      for (const c of post) {
        const C = capOf(c.cap);
        C.score += f.conf * c.p;
        f.sources.forEach(s => { C.sources.add(s); (C.byMove[moveOf(f.id)] = C.byMove[moveOf(f.id)] || new Set()).add(s); });
        C.sessions += f.n;
        if (c.p >= 0.25) C.why.push(`${f.label}（${f.details[0]}${f.n > 1 ? ` 等 ${f.n} 次` : ""}）→ 可能原因：${c.why}${c.notes.length ? "；" + c.notes.join("；") : ""}（占 ${Math.round(c.p * 100)}%）`);
        C.findings.push(f.id);
      }
      if (post[1] && post[0].p - post[1].p < 0.15 && f.conf >= 0.3) {
        const tn = (R.tests ? R.tests(ctx) : []).filter(Boolean);
        tn.forEach(t => tests_needed.add(t));
        undecided.push(`${f.label}：还不能确定是“${CAPS[post[0].cap].name}”还是“${CAPS[post[1].cap].name}”的问题${tn.length ? "，建议做：" + tn.join("、") : "，建议复测后再看"}`);
      }
      if (R.safety && f.conf >= 0.3) cautions.push({ level: "safety", text: `${f.label}：${R.safety}。须由教练或队医判断后再加大训练强度。` });
    }
    // 体能测试短板（直接测量，可信度高）。注意来源独立性：雷达里的“技术”分来自同一段视频的触地时间、“恢复”分来自每日打卡，
    // 这两项和视频诊断、每日状态是同一份数据，不能再算一个独立来源（否则会把“同一个证据说两遍”当成互相印证）
    for (const x of (P && P.radar) || []) {
      if (!isF(x.score) || x.score >= 95 || !CAPS[x.key]) continue;
      if (x.key === "tech" || x.key === "recovery") continue;
      const fromVideo = x.key === "speed" && P.cur && P.cur.vmaxSrc === "视频分析";
      const C = capOf(x.key);
      C.score += clamp((100 - x.score) / 20, 0, 1.5);
      C.sources.add(fromVideo ? "video" : "test");
      C.why.push(`体能测试：${x.name} ${x.score} 分（目标模型 = 100），现在 ${x.cur}，目标 ${x.tgt}`);
    }
    // 每日状态
    const W = (a.wellness || []).filter(w => (today - new Date(w.date)) / 864e5 <= 7);
    if (W.length >= 3) {
      const sleep = W.reduce((s, w) => s + (w.sleep || 0), 0) / W.length, fat = W.reduce((s, w) => s + (w.fatigue || 0), 0) / W.length;
      if (sleep < 7 || fat >= 3.5) {
        const C = capOf("recovery"); C.score += sleep < 6.5 || fat >= 4 ? 1.2 : 0.7; C.sources.add("wellness");
        C.why.push(`近 7 天平均睡眠 ${sleep.toFixed(1)} 小时、疲劳 ${fat.toFixed(1)}/5`);
      }
    }
    if (isF(opts.acwr) && opts.acwr > 1.5) cautions.push({ level: "load", text: `近 7 天负荷是前 4 周平均的 ${opts.acwr.toFixed(2)} 倍：负荷突增，近期不要再加量（负荷比只作提醒，学界对它的预测作用有争议）。` });
    for (const x of injuries.filter(x => x.status === "current")) cautions.push({ level: "injury", text: `当前伤病：${INJURY_PARTS[x.part] || x.part}${x.note ? "（" + x.note + "）" : ""}。计划已按部位调整，恢复训练的进度须由队医或康复师确认。` });

    // 可信度：多个独立来源互相印证 → 高；单一来源但多次出现或分数高 → 中
    const priorities = Object.values(caps).filter(C => C.score >= 0.3).map(C => {
      // 技术：同一个动作有两个以上来源才算互相印证（深蹲动作有问题，不能证明短跑技术有问题）；身体能力（力量、灵活性……）跨动作通用
      const nSrc = C.key === "tech" ? Math.max(0, ...Object.values(C.byMove).map(x => x.size)) : C.sources.size;
      const confidence = nSrc >= 2 ? "高" : (C.score >= 1 || C.sessions >= 2) ? "中" : "低";
      return { key: C.key, name: CAPS[C.key].name, score: Math.round(C.score * 100) / 100, confidence, sources: [...C.sources], why: C.why,
        principles: CAPS[C.key].principles, retest: CAPS[C.key].retest, addon: CAPS[C.key].addon };
    }).sort((x, y) => y.score - x.score);
    const gaps = [];
    if (!findings.length) gaps.push("还没有视频分析或实时捕捉记录：先拍一段主项技术视频，或用实时捕捉测深蹲和单腿站立。");
    if (!Object.keys(tests).length) gaps.push("还没有体能测试成绩：先测立定跳远、深蹲、30 米跑。");
    return { findings, priorities, focus: priorities.slice(0, 3).map(p => p.key), undecided, testsNeeded: [...tests_needed], cautions, gaps, excluded: opts.excluded || [] };
  }

  const INJURY_PARTS = { hamstring: "腘绳肌（大腿后侧）", knee: "膝", ankle: "踝", lowback: "腰背", shoulder: "肩", hip: "髋/腹股沟", other: "其他部位" };

  const API = { CAPS, RULES, INJURY_PARTS, observationsFromRecords, reason, HALF_LIFE_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.BRAIN = API;
})(typeof self !== "undefined" ? self : this);
