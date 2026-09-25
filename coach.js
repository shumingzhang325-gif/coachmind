/* 知练 CoachMind 教练大脑：运动员画像、目标模型、多学科分析、周期计划、每日状态
   所有文献均在 PubMed 或原文核对过；标注“经验值”的数字是教练常用参考，需要老师/教练校准。 */
(function (root) {
  "use strict";
  const isF = Number.isFinite;
  const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------- 文献 ----------------
  const REFS = {
    weyand2000: { t: "Weyand PG, et al. Faster top running speeds are achieved with greater ground forces not more rapid leg movements. J Appl Physiol. 2000;89(5):1991-9.", doi: "10.1152/jappl.2000.89.5.1991" },
    nagahara2018: { t: "Nagahara R, et al. Association of sprint performance with ground reaction forces during acceleration and maximal speed phases in a single sprint. J Appl Biomech. 2018;34(2):104-110.", doi: "10.1123/jab.2016-0356" },
    haugen2019: { t: "Haugen T, et al. The training and development of elite sprint performance: an integration of scientific and best practice literature. Sports Med Open. 2019;5(1):44.", doi: "10.1186/s40798-019-0221-0" },
    coh2018: { t: "Čoh M, et al. Kinematics of Usain Bolt's maximal sprint velocity. Kinesiology. 2018;50(2):172-180.", doi: null },
    samozino2016: { t: "Samozino P, et al. A simple method for measuring power, force, velocity properties, and mechanical effectiveness in sprint running. Scand J Med Sci Sports. 2016;26(6):648-58.", doi: "10.1111/sms.12490" },
    rumpf2016: { t: "Rumpf MC, et al. Effect of different sprint training methods on sprint performance over various distances: a brief review. J Strength Cond Res. 2016;30(6):1767-85.", doi: "10.1519/JSC.0000000000001245" },
    seitz2014: { t: "Seitz LB, et al. Increases in lower-body strength transfer positively to sprint performance: a systematic review with meta-analysis. Sports Med. 2014;44(12):1693-702.", doi: "10.1007/s40279-014-0227-1" },
    devillarreal2012: { t: "Sáez de Villarreal E, et al. The effects of plyometric training on sprint performance: a meta-analysis. J Strength Cond Res. 2012;26(2):575-84.", doi: "10.1519/JSC.0b013e318220fd03" },
    issurin2010: { t: "Issurin VB. New horizons for the methodology and physiology of training periodization. Sports Med. 2010;40(3):189-206.", doi: "10.2165/11319770-000000000-00000" },
    vandyk2019: { t: "van Dyk N, et al. Including the Nordic hamstring exercise in injury prevention programmes halves the rate of hamstring injuries. Br J Sports Med. 2019;53(21):1362-1370.", doi: "10.1136/bjsports-2018-100045" },
    gabbett2016: { t: "Gabbett TJ. The training-injury prevention paradox: should athletes be training smarter and harder? Br J Sports Med. 2016;50(5):273-80.", doi: "10.1136/bjsports-2015-095788" },
    jager2017: { t: "Jäger R, et al. ISSN position stand: protein and exercise. J Int Soc Sports Nutr. 2017;14:20.", doi: "10.1186/s12970-017-0177-8" },
    kreider2017: { t: "Kreider RB, et al. ISSN position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. J Int Soc Sports Nutr. 2017;14:18.", doi: "10.1186/s12970-017-0173-z" },
    mah2011: { t: "Mah CD, et al. The effects of sleep extension on the athletic performance of collegiate basketball players. Sleep. 2011;34(7):943-50.", doi: "10.5665/SLEEP.1132" },
    suchomel2015: { t: "Suchomel TJ, et al. Weightlifting pulling derivatives: rationale for implementation and application. Sports Med. 2015;45(6):823-39.", doi: "10.1007/s40279-015-0314-y" },
  };

  // 优秀运动员最高速度段参考（Čoh 等 2018：博尔特 2011 萨格勒布，60–90 m）
  const ELITE = { name: "博尔特", note: "2011 萨格勒布 100 m 最高速段", v: 12.14, sl: 2.70, sf: 4.36, ct: 0.086, ft: 0.145, ref: "coh2018" };

  // ---------------- 测试项目 ----------------
  const TESTS = {
    flying30: { name: "30 米行进间跑", unit: "s", low: true, hint: "助跑 20–30 米后计时 30 米" },
    t30: { name: "30 米站立式起跑", unit: "s", low: true, hint: "从静止启动开始计时" },
    t60: { name: "60 米", unit: "s", low: true },
    slj: { name: "立定跳远", unit: "m", low: false },
    cmj: { name: "纵跳（CMJ）", unit: "cm", low: false },
    rsi: { name: "跳深反应力量指数", unit: "", low: false, hint: "腾空高度 ÷ 触地时间" },
    squat: { name: "深蹲 1RM", unit: "kg", low: false },
    clean: { name: "高翻 1RM", unit: "kg", low: false },
  };
  // 经验参考目标（可在档案中修改）
  const DEFAULT_TARGETS = {
    男: { squat_ratio: 2.0, slj: 3.0, ct: 0.10, decel_loss: 0.15 },
    女: { squat_ratio: 1.6, slj: 2.5, ct: 0.105, decel_loss: 0.15 },
  };

  // ---------------- 短跑单指数模型 ----------------
  // v(t) = vmax(1 − e^(−t/τ))，x(t) = vmax[t − τ(1 − e^(−t/τ))]。未计后程减速。
  const RT = 0.15;                 // 起跑反应时（经验值）
  const TAU_DEFAULT = 1.2;         // 由 Samozino 2016 数据推算：vmax≈10.5 m/s、最大水平推力≈8.5 m/s² → τ≈1.2 s
  const xAt = (t, v, tau) => v * (t - tau * (1 - Math.exp(-t / tau)));
  function tAt(d, v, tau) {
    let lo = 0, hi = 60;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (xAt(m, v, tau) < d) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  function vmaxFor100(T, tau) {
    let lo = 3, hi = 15;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (RT + tAt(100, m, tau) > T) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  function tauFrom30(v, t30) {                   // 已知最高速度和 30 米起跑成绩，反推加速常数 τ
    if (!(isF(v) && isF(t30)) || t30 * v <= 30) return null;
    let lo = 0.3, hi = 3;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (tAt(30, v, m) < t30) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  // ---------------- 画像 ----------------
  function latestTests(a) {
    const out = {};
    for (const t of (a.tests || []).slice().sort((x, y) => x.date < y.date ? -1 : 1)) out[t.type] = t;
    return out;
  }
  function targets(a) { return Object.assign({}, DEFAULT_TARGETS[a.sex === "女" ? "女" : "男"], a.targets || {}); }

  function recentWellness(a, days = 7) {
    const since = Date.now() - days * 864e5;
    return (a.wellness || []).filter(w => new Date(w.date).getTime() >= since);
  }

  function profile(a, video) {
    const T = latestTests(a), tg = targets(a), notes = [];
    const cur = {}, tgt = {};
    // 当前最高速度：行进间 30 米 > 视频 > 由 PB 反推
    if (T.flying30) { cur.vmax = 30 / T.flying30.value; cur.vmaxSrc = "30 米行进间跑"; }
    else if (video && isF(video.speed_mps)) { cur.vmax = video.speed_mps; cur.vmaxSrc = "视频分析"; }
    else if (isF(a.pb)) { cur.vmax = vmaxFor100(a.pb, TAU_DEFAULT); cur.vmaxSrc = "由 100 米成绩推算"; }
    cur.tau = isF(cur.vmax) && T.t30 ? tauFrom30(cur.vmax, T.t30.value) : null;
    const tau = cur.tau || TAU_DEFAULT;
    if (!cur.tau) notes.push("没有 30 米起跑成绩，加速能力按典型值估算");
    if (isF(cur.vmax)) { cur.t30 = T.t30 ? T.t30.value : tAt(30, cur.vmax, tau); cur.pred100 = RT + tAt(100, cur.vmax, tau); }
    if (isF(a.goalTime)) {
      tgt.vmax = vmaxFor100(a.goalTime, Math.min(tau, TAU_DEFAULT));
      tgt.t30 = tAt(30, tgt.vmax, Math.min(tau, TAU_DEFAULT));
      tgt.flying30 = 30 / tgt.vmax;
    }
    // 步长步频组合
    const sl = video && isF(video.step_length_m) ? video.step_length_m : null;
    const sf = video && isF(video.step_frequency_hz) ? video.step_frequency_hz : null;
    let combos = null;
    if (isF(tgt.vmax)) {
      combos = { vmax: tgt.vmax };
      if (sl) combos.sfAtSameSL = tgt.vmax / sl, combos.sl = sl;
      if (sf) combos.slAtSameSF = tgt.vmax / sf, combos.sf = sf;
      if (!sl && !sf && isF(a.height_cm)) combos.table = [1.15, 1.2, 1.25, 1.3].map(k => { const L = k * a.height_cm / 100; return { k, sl: L, sf: tgt.vmax / L }; });
    }

    // 六维雷达：100 = 达到目标模型
    const bw = a.weight_kg;
    const W = recentWellness(a);
    const radar = [
      { key: "speed", name: "速度", score: isF(cur.vmax) && isF(tgt.vmax) ? 100 * cur.vmax / tgt.vmax : null,
        cur: isF(cur.vmax) ? `${r2(cur.vmax)} m/s` : null, tgt: isF(tgt.vmax) ? `${r2(tgt.vmax)} m/s` : null, need: "30 米行进间跑或 100 米成绩" },
      { key: "accel", name: "加速", score: T.t30 && isF(tgt.t30) ? 100 * tgt.t30 / T.t30.value : null,
        cur: T.t30 ? `${T.t30.value} s` : null, tgt: isF(tgt.t30) ? `${r2(tgt.t30)} s` : null, need: "30 米站立式起跑" },
      { key: "se", name: "速度耐力", score: isF(a.pb) && isF(cur.pred100) && T.flying30 ? clamp(100 - (a.pb - cur.pred100 - tg.decel_loss) * 200, 0, 100) : null,
        cur: isF(a.pb) && isF(cur.pred100) && T.flying30 ? (a.pb - cur.pred100 < -0.05 ? "数据矛盾：100 米成绩比行进间 30 米推算的还快，建议复测" : `后程损失 ${r2(Math.max(0, a.pb - cur.pred100))} s`) : null, tgt: `≤ ${tg.decel_loss} s（经验值）`, need: "100 米成绩和 30 米行进间跑" },
      { key: "strength", name: "力量", score: T.squat && isF(bw) ? 100 * (T.squat.value / bw) / tg.squat_ratio : null,
        cur: T.squat && isF(bw) ? `${r2(T.squat.value / bw)} 倍体重` : null, tgt: `${tg.squat_ratio} 倍体重（经验值）`, need: "深蹲 1RM 和体重" },
      { key: "power", name: "爆发力", score: T.slj ? 100 * T.slj.value / tg.slj : null,
        cur: T.slj ? `${T.slj.value} m` : null, tgt: `${tg.slj} m（经验值）`, need: "立定跳远" },
      { key: "tech", name: "技术", score: video && isF(video.contact_time_s) ? 100 * tg.ct / video.contact_time_s : null,
        cur: video && isF(video.contact_time_s) ? `触地 ${video.contact_time_s.toFixed(3)} s` : null, tgt: `≤ ${tg.ct} s（经验值；博尔特 ${ELITE.ct} s）`, need: "一段途中跑视频" },
      { key: "recovery", name: "恢复", score: W.length ? mean(W.map(w => (clamp(w.sleep / 8, 0, 1.1) + (5 - w.fatigue) / 4 + (5 - w.soreness) / 4) / 3 * 100)) : null,
        cur: W.length ? `近 7 天睡眠 ${r1(mean(W.map(w => w.sleep)))} 小时` : null, tgt: "睡眠 8 小时以上、疲劳和酸痛低", need: "每日状态打卡" },
    ].map(x => Object.assign(x, { score: isF(x.score) ? Math.round(clamp(x.score, 0, 130)) : null }));

    const scored = radar.filter(x => isF(x.score));
    const weakest = scored.slice().sort((x, y) => x.score - y.score).slice(0, 2).filter(x => x.score < 98).map(x => x.key);
    const improvePct = isF(a.pb) && isF(a.goalTime) ? (a.pb - a.goalTime) / a.pb * 100 : null;
    return { cur, tgt, combos, radar, weakest, improvePct, notes, tau, targets: tg, tests: T };
  }
  function mean(a) { const v = a.filter(isF); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; }

  // ---------------- 多学科分析 ----------------
  function insights(a, P, video) {
    const out = [];
    const sport = a.sport && root.SPORTLIB ? root.SPORTLIB.byId(a.sport) : null;
    if (sport && sport.group !== "speed") {
      const G = GROUP_PLANS[sport.group];
      out.push({ area: "运动训练学", title: `${sport.name}：项群特点与训练重点`, bullets: [G.traits].concat(G.priorities), refs: ["issurin2010"], level: "教材共识 + 经验" });
      out.push({ area: "测试与监控", title: "建议的测试指标", bullets: G.tests.concat(["每次训练后记录 RPE 与时长，跟踪周负荷变化"]), refs: ["gabbett2016"] });
      out.push({ area: "康复与伤病预防", title: "这个项群的伤病预防重点", bullets: G.prehab, refs: sport.group === "field" ? ["vandyk2019"] : [], level: sport.group === "field" ? "" : "经验" });
      if (root.SPORTLIB) {
        const t = sport.techniques[0];
        out.push({ area: "运动生物力学", title: `${t.name}：关键技术点`, bullets: t.keyPoints, refs: [], level: "教练经验" });
      }
      if (isF(a.weight_kg)) out.push({ area: "运动营养学", title: "蛋白质与补剂", bullets: [`按 ${a.weight_kg} kg 体重，每天蛋白质约 ${Math.round(a.weight_kg * 1.4)}–${Math.round(a.weight_kg * 2.0)} g，分 4–5 次摄入。`, "肌酸对高强度间歇与力量项目证据充分；是否使用请和队医确认。"], refs: ["jager2017", "kreider2017"] });
      out.push({ area: "恢复与睡眠", title: "恢复", bullets: ["睡眠是最有效的恢复手段；每天早上打卡，App 会根据睡眠、疲劳和酸痛调整当天强度。"], refs: ["mah2011"] });
      return out;
    }
    const W = recentWellness(a);
    // 运动训练学：差距与优先级
    {
      const b = [];
      if (isF(P.improvePct)) b.push(`目标是从 ${a.pb} 秒提高到 ${a.goalTime} 秒，需要快 ${r1(P.improvePct)}%。`);
      if (isF(P.cur.vmax) && isF(P.tgt.vmax)) b.push(`按模型估算，最高速度要从 ${r2(P.cur.vmax)} 提高到 ${r2(P.tgt.vmax)} m/s（+${r2(P.tgt.vmax - P.cur.vmax)}）。模型没算后程减速，实际需要再高一点。`);
      const names = { speed: "最高速度", accel: "加速", se: "速度耐力", strength: "下肢力量", power: "爆发力", tech: "途中跑技术", recovery: "恢复" };
      if (P.weakest.length) b.push(`当前最明显的短板：${P.weakest.map(k => names[k]).join("、")}。计划会给这两项更多训练量。`);
      const missing = P.radar.filter(x => !isF(x.score)).map(x => x.need);
      if (missing.length) b.push(`还缺这些数据，补上后判断更准：${[...new Set(missing)].join("；")}。`);
      b.push("专项冲刺训练（自由冲刺、抗阻与助力冲刺）对各距离成绩的提高效果最明确；力量和快速伸缩复合训练作为补充。");
      out.push({ area: "运动训练学", title: "目标差距与训练优先级", bullets: b, refs: ["rumpf2016", "haugen2019", "samozino2016"] });
    }
    // 运动生物力学
    {
      const b = [];
      if (video && isF(video.contact_time_s)) {
        b.push(`途中跑触地 ${video.contact_time_s.toFixed(3)} s；参考博尔特最高速段 ${ELITE.ct} s、腾空 ${ELITE.ft} s。`);
        if (isF(video.flight_time_s)) b.push(`触地/腾空比 ${r2(video.contact_time_s / video.flight_time_s)}（博尔特约 ${r2(ELITE.ct / ELITE.ft)}）。比值越小，说明越能在短时间内完成蹬伸。`);
      }
      if (P.combos) {
        if (P.combos.sfAtSameSL) b.push(`保持现在的步长 ${r2(P.combos.sl)} m，步频要达到 ${r2(P.combos.sfAtSameSL)} 步/秒；保持现在的步频 ${r2(P.combos.sf)} 步/秒，步长要达到 ${r2(P.combos.slAtSameSF)} m。`);
        else if (P.combos.table) b.push(`达到目标速度的步长步频组合（按身高 ${a.height_cm} cm）：` + P.combos.table.map(c => `步长 ${r2(c.sl)} m × 步频 ${r2(c.sf)}`).join("，") + "。");
      }
      b.push("最高速度的差异主要来自触地时向地面施加的力，而不是空中摆腿更快；训练重点放在触地期的力量输出和着地位置。");
      if (video && isF(video.touchdown_distance_m) && video.touchdown_distance_m > 0.35) b.push(`着地点在髋前 ${r2(video.touchdown_distance_m)} m，偏远，会增加制动。`);
      out.push({ area: "运动生物力学", title: "技术动作与优秀运动员对比", bullets: b, refs: ["weyand2000", "nagahara2018", "coh2018"] });
    }
    // 运动生理学
    out.push({ area: "运动生理学", title: "能量代谢与负荷安排", bullets: [
      "100 米以磷酸原系统为主，后程糖酵解参与增加。最大速度训练要保证组间充分恢复，否则练成的是速度耐力而不是速度。",
      "经验做法：最大速度和加速练习组间 3–6 分钟；速度耐力（120–150 米）组间 8–10 分钟；高强度冲刺课每周 2–3 次，中间安排节奏跑或恢复课。",
      P.weakest.includes("se") ? "速度耐力是短板：专项准备期起加入 120–150 米重复跑，赛前期加入比赛模拟。" : "速度耐力暂不是主要短板，保持每周一次即可。",
    ], refs: ["haugen2019"], level: "综述 + 经验值" });
    // 力量与体能
    {
      const b = [];
      if (P.tests.squat && isF(a.weight_kg)) b.push(`深蹲 ${P.tests.squat.value} kg，为体重的 ${r2(P.tests.squat.value / a.weight_kg)} 倍，参考目标 ${P.targets.squat_ratio} 倍（经验值）。`);
      b.push("下肢力量提高能迁移到冲刺成绩：荟萃分析中平均冲刺提高约 3%，每周训练次数越多、组间休息越充分，效果越好。");
      b.push("快速伸缩复合训练：少于 10 周、至少 15 次课、每次 80 次以上跳跃的高强度方案效果较好；多种跳跃结合、以水平方向为主的跳跃更有利于冲刺，负重跳没有额外好处。");
      b.push("高翻、跳耸肩等举重拉的动作可以练三关节伸展的爆发力。");
      out.push({ area: "力量与体能", title: "力量与爆发力发展", bullets: b, refs: ["seitz2014", "devillarreal2012", "suchomel2015"] });
    }
    // 营养
    if (isF(a.weight_kg)) out.push({ area: "运动营养学", title: "蛋白质与补剂", bullets: [
      `按 ${a.weight_kg} kg 体重，每天蛋白质约 ${Math.round(a.weight_kg * 1.4)}–${Math.round(a.weight_kg * 2.0)} g（1.4–2.0 g/kg），分 4–5 次，每次 20–40 g，间隔 3–4 小时，训练前后都可以。`,
      "肌酸是证据最充分的补剂之一，能提高高强度运动表现、帮助承受大训练量；是否使用请和队医确认。",
    ], refs: ["jager2017", "kreider2017"] });
    // 伤病预防
    {
      const b = ["每周 1–2 次北欧挺（离心腘绳肌训练）。纳入北欧挺的预防方案，可使腘绳肌损伤发生率降低约一半；短跑是腘绳肌拉伤高发项目。"];
      const acwr = loadRatio(a);
      if (isF(acwr)) b.push(`近 7 天负荷与近 28 天周平均之比为 ${r2(acwr)}。负荷突然大幅增加与软组织损伤有关，建议每周增幅平稳。注意：用这个比值预测受伤在学界有争议，只作提醒。`);
      else b.push("训练后记录 RPE 和训练时长，App 会计算负荷变化，提醒负荷突增。");
      out.push({ area: "康复与伤病预防", title: "腘绳肌保护与负荷管理", bullets: b, refs: ["vandyk2019", "gabbett2016"] });
    }
    // 恢复
    out.push({ area: "恢复与睡眠", title: "睡眠是免费的训练", bullets: [
      W.length ? `近 7 天平均睡眠 ${r1(mean(W.map(w => w.sleep)))} 小时，疲劳 ${r1(mean(W.map(w => w.fatigue)))}/5，酸痛 ${r1(mean(W.map(w => w.soreness)))}/5。` : "还没有状态打卡数据，建议每天早上花 10 秒打卡。",
      "大学生篮球运动员把睡眠延长到每晚约 10 小时卧床，数周后冲刺成绩、反应时和情绪都有改善。",
    ], refs: ["mah2011"] });
    // 心理
    out.push({ area: "运动心理学", title: "放松地快跑", bullets: [
      "最高速度段追求“快而放松”，脸部、肩部紧张会限制摆臂和步频。训练中可以用“最后 20 米放松保持”的提示语。",
      "建立固定的赛前流程（热身顺序、提示语、呼吸），让比赛日和训练日一样。",
    ], refs: [], level: "专家经验，待补充文献" });
    return out;
  }

  // ---------------- 负荷与状态 ----------------
  function loadRatio(a) {
    const now = Date.now(), L = d => (a.wellness || []).filter(w => w.rpe && w.minutes && now - new Date(w.date).getTime() < d * 864e5).reduce((s, w) => s + w.rpe * w.minutes, 0);
    const dates = (a.wellness || []).filter(w => w.rpe && w.minutes).map(w => new Date(w.date).getTime());
    if (!dates.length || now - Math.min(...dates) < 21 * 864e5) return null;      // 不足 3 周历史，不计算
    const acute = L(7), chronic = L(28) / 4;
    return chronic > 0 ? acute / chronic : null;
  }
  function readiness(a) {
    const today = new Date().toISOString().slice(0, 10);
    const w = (a.wellness || []).find(x => x.date === today);
    if (!w) return { level: "none", text: "早上花 10 秒打卡，App 会据此调整当天的训练强度" };
    const reasons = [];
    if (w.sleep < 6) reasons.push(`睡眠 ${w.sleep} 小时`);
    if (w.fatigue >= 4) reasons.push(`疲劳 ${w.fatigue}/5`);
    if (w.soreness >= 4) reasons.push(`酸痛 ${w.soreness}/5`);
    const acwr = loadRatio(a);
    if (isF(acwr) && acwr > 1.5) reasons.push(`负荷突增（${r2(acwr)}）`);
    const level = reasons.length >= 2 ? "red" : reasons.length === 1 ? "yellow" : "green";
    const text = { green: "状态良好，按计划训练", yellow: "今天降低强度：冲刺改为技术课或节奏跑，力量减一组", red: "今天以恢复为主：只做灵活性、放松跑和软组织处理" }[level];
    return { level, text, reasons, w };
  }

  // ---------------- 周期计划 ----------------
  const DAY_SLOTS = { 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 3, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
  const WEEKDAY = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const PHASES = [
    { key: "gp", name: "一般准备期", share: 0.35, goal: "打力量和技术基础，逐步提高训练量", color: "--ph1" },
    { key: "sp", name: "专项准备期", share: 0.35, goal: "把力量转化为速度，发展最高速度", color: "--ph2" },
    { key: "cp", name: "赛前期", share: 0.2, goal: "速度耐力与比赛模拟，量减强度保持", color: "--ph3" },
    { key: "taper", name: "调整比赛期", share: 0.1, goal: "减量保强度，让身体恢复到最佳状态", color: "--ph4" },
  ];
  const TEMPLATES = {
    gp: [["acc", "str"], ["tempo", "core"], ["ply", "tech"], ["str", "nordic"], ["tempo"], ["acc"]],
    sp: [["acc", "str"], ["maxv", "ply"], ["tempo", "core"], ["se", "str"], ["maxv"], ["tempo"]],
    cp: [["acc", "maxv"], ["tempo"], ["se"], ["str", "ply"], ["race"], ["tempo"]],
    taper: [["acc", "maxv"], ["tempo"], ["race"], ["tempo"], ["rest"], ["rest"]],
  };
  function content(type, ph, deload, focus) {
    const d = deload ? 0.6 : 1, n = (lo, hi) => { const v = Math.max(1, Math.round((ph === "gp" ? lo : ph === "taper" ? lo : hi) * d)); return v; };
    const up = k => focus.includes(k);
    switch (type) {
      case "acc": return { t: "加速", items: [`技术练习：A 走、A 跳、小步跑 各 2×20 m`, `${n(6, 8) + (up("accel") ? 2 : 0)} × ${ph === "gp" ? "20" : "30"} m 起跑加速，走回恢复约 2–3 分钟`, ph === "sp" || up("accel") ? `${n(3, 4)} × 20 m 雪橇抗阻冲刺（负重以速度下降不太明显为宜）` : null] };
      case "maxv": return { t: "最高速度", items: [`${n(3, 5) + (up("speed") ? 1 : 0)} × 飞跑 20–30 m（助跑 20–30 m），组间 4–6 分钟完全恢复`, "要求：放松、高重心、着地点在身体下方"] };
      case "se": return { t: "速度耐力", items: [`${n(2, 4) + (up("se") ? 1 : 0)} × ${ph === "cp" ? "150" : "120"} m @ 90–95%，组间 8–10 分钟`] };
      case "tempo": return { t: "节奏跑", items: [`${n(6, 10)} × 100 m @ 约 70% 速度，走 100 m 恢复`, "目的：恢复、有氧基础、放松技术"] };
      case "str": return { t: "力量", items: ph === "gp"
        ? [`深蹲 ${n(4, 4)}×6 @ 约 75% 1RM`, "罗马尼亚硬拉 3×8", "单腿蹲或弓步 3×8/侧", up("strength") ? "加一组深蹲（力量是当前短板）" : null]
        : ph === "taper" ? ["深蹲 2×3 @ 约 80%，保持即可"]
        : [`深蹲 ${n(3, 4)}×3–5 @ 80–90% 1RM`, "高翻或跳耸肩 4×3", up("strength") ? "深蹲加一组" : null] };
      case "ply": return { t: "快速伸缩复合", items: [ph === "gp" ? `跳跃总次数约 ${Math.round(80 * d)}：连续跳、跨步跳、立定跳` : `跳跃总次数约 ${Math.round((up("power") || up("reactive") ? 120 : 100) * d)}：栏架跳、跨步跳、跳深，以水平方向为主`, up("reactive") ? "强调短触地（视频诊断：反应力量不足）" : null] };
      case "core": return { t: "核心与灵活性", items: ["平板支撑、侧桥、死虫 各 3 组", "髋部灵活性 10 分钟"] };
      case "nordic": return { t: "北欧挺", items: [`${deload ? 2 : 3}×5 离心控制`] };
      case "tech": return { t: "技术", items: ["直腿跑、A/B 步、摆臂练习", up("tech") ? "针对视频诊断的问题做专门技术练习" : null] };
      case "race": return { t: ph === "taper" ? "比赛或测试" : "比赛模拟", items: [ph === "taper" ? "比赛日 / 测试日" : "1–2 次全程或 80 米模拟，完全恢复"] };
      case "rest": return { t: "休息", items: ["完全休息或轻松活动"] };
    }
    return { t: type, items: [] };
  }
  // ---------------- 各项群训练计划库（国家队教练视角，模板需结合队伍实际调整） ----------------
  // 每个项群：特点、训练重点、测试指标、伤病预防重点；课型库（按阶段给出内容）；各阶段一周课表
  const GROUP_PLANS = {
    power: {
      name: "快速力量性（跳跃、投掷、举重）",
      traits: "单次动作 1 秒以内完成，磷酸原供能为主；成绩取决于最大力量、发力速度与技术稳定性。",
      priorities: ["最大力量打底，逐步转化为爆发力（力量—速度曲线右移）", "专项技术在高强度下保持稳定", "神经系统恢复充分：高强度课之间至少间隔 48 小时"],
      tests: ["立定跳远 / 纵跳（CMJ）", "深蹲、高翻 1RM", "30 米加速跑", "专项成绩（助跑跳远、投掷距离、抓举/挺举）"],
      prehab: ["膝关节（髌腱）负荷管理：跳跃总次数周波动控制", "下背部：核心抗伸展训练", "肩关节（投掷、举重）：肩袖与肩胛稳定"],
      lib: {
        tech: { t: "专项技术", gp: ["短程/低强度专项技术，强调动作结构", "技术分解练习 + 录像回看"], sp: ["全程或接近全程技术，强度 85%–95%", "每次试跳/试举后即时反馈"], cp: ["模拟比赛：按比赛轮次与间歇完成", "固定赛前热身流程"], taper: ["少量高质量试跳/试举，保持节奏"] },
        maxstr: { t: "最大力量", gp: ["深蹲、硬拉 4×6 @ 70%–80%", "单腿力量、后链训练"], sp: ["深蹲、高翻 4–5×2–3 @ 85%–92%"], cp: ["维持：2–3×2 @ 85%–90%，总量减半"], taper: ["2×2 @ 80%，保持神经兴奋"] },
        power: { t: "爆发力", gp: ["药球抛、跳跃基础（每课约 80 次触地）"], sp: ["高翻/抓举、负重跳、跳深（每课 60–100 次高强度）"], cp: ["少量高质量跳跃与抛掷"], taper: ["5–6 次最大努力跳跃"] },
        speed: { t: "速度", gp: ["20–30 米加速跑 6–8 次"], sp: ["助跑速度练习、飞跑 20 米"], cp: ["专项助跑节奏"], taper: ["短冲 3–4 次"] },
        core: { t: "核心与预防", gp: ["核心抗伸展/抗旋转", "肩袖、踝稳定"], sp: ["核心 + 北欧挺"], cp: ["维持性预防训练"], taper: ["灵活性与放松"] },
        rec: { t: "恢复", gp: ["低强度有氧 20–30 分钟 + 灵活性"], sp: ["放松跑、泡沫轴"], cp: ["放松与心理准备"], taper: ["完全恢复"] },
      },
      week: { gp: ["tech", "maxstr", "rec", "power", "maxstr", "core"], sp: ["tech", "power", "rec", "maxstr", "speed", "core"], cp: ["tech", "power", "rec", "tech", "maxstr", "rec"], taper: ["tech", "rec", "power", "rec", "tech", "rec"] },
    },
    endurance: {
      name: "耐力性（中长跑、游泳、自行车、赛艇）",
      traits: "有氧供能为主，比拼最大摄氧量、乳酸阈和动作经济性；训练量大，恢复管理决定上限。",
      priorities: ["大部分训练（约七到八成）在低强度区完成，高强度课少而精（极化分布，经验）", "乳酸阈与最大摄氧量间歇交替安排", "力量训练改善动作经济性，不追求大体积"],
      tests: ["专项计时测试（如 3000 米 / 1500 米）", "乳酸阈测试（有条件时）", "晨脉与心率变异性趋势", "体重与睡眠"],
      prehab: ["胫骨应力、跟腱、足底：周跑量每周增幅不宜过大", "髋外展肌力量（膝前痛、髂胫束）", "女性运动员能量可利用性（避免长期能量不足）"],
      lib: {
        easy: { t: "低强度有氧", gp: ["轻松跑/骑/游 45–90 分钟，能完整说话的强度"], sp: ["轻松有氧 40–70 分钟"], cp: ["轻松有氧 30–50 分钟"], taper: ["轻松有氧 20–30 分钟"] },
        threshold: { t: "乳酸阈", gp: ["节奏跑 20–30 分钟或 4–5×6 分钟，组间 1 分钟"], sp: ["阈强度间歇 5×8 分钟 / 3×15 分钟"], cp: ["比赛配速段落练习"], taper: ["短阈段 2–3×5 分钟"] },
        vo2: { t: "最大摄氧量间歇", gp: ["坡道冲刺 8–10×10 秒（神经与力量）"], sp: ["5–6×3 分钟，组间等时慢跑"], cp: ["比赛强度间歇，量减少"], taper: ["3–4×2 分钟保持锋利度"] },
        long: { t: "长距离", gp: ["长距离低强度，逐周增加 5%–10%"], sp: ["长距离含后段加速"], cp: ["长距离缩短"], taper: ["取消"] },
        strength: { t: "力量", gp: ["深蹲、单腿蹲、提踵 3×8–10", "核心稳定"], sp: ["力量维持 + 跳绳/跳跃（跑步经济性）"], cp: ["维持：每周 1 次"], taper: ["灵活性"] },
        rec: { t: "恢复", gp: ["休息或极轻松活动"], sp: ["休息或极轻松活动"], cp: ["休息"], taper: ["休息"] },
      },
      week: { gp: ["easy", "threshold", "easy", "strength", "long", "easy"], sp: ["easy", "vo2", "easy", "threshold", "long", "strength"], cp: ["easy", "threshold", "easy", "vo2", "easy", "rec"], taper: ["easy", "vo2", "rec", "easy", "rec", "rec"] },
    },
    aesthetic: {
      name: "表现难美性（体操、跳水、艺术体操、花样滑冰）",
      traits: "难度动作与完成质量并重；柔韧、空间感、核心控制与心理稳定性是基础。成套动作由高质量的基本功堆出来。",
      priorities: ["基本功与身体姿态每天练", "新难度动作：分解 → 保护/蹦床/海绵坑 → 独立完成，循序渐进", "成套练习随赛期临近增加，强调完成率与稳定性"],
      tests: ["柔韧（坐位体前屈、劈叉、肩部柔韧）", "纵跳、立定跳远（弹跳）", "悬垂举腿、倒立时间（核心与上肢）", "成套完成率与裁判评分"],
      prehab: ["腰椎（反复后弯）：限制高重复后弯次数，强化核心", "腕、肘（支撑类动作）", "落地冲击：膝、踝；新动作必须有保护"],
      lib: {
        basics: { t: "基本功与柔韧", gp: ["芭蕾把杆 / 基本姿态 30 分钟", "主动柔韧与控制"], sp: ["基本功 20 分钟（维持）"], cp: ["赛前基本功热身流程"], taper: ["轻量基本功"] },
        skills: { t: "难度动作", gp: ["新动作分解与辅助练习（蹦床/海绵坑/保护）"], sp: ["难度动作连接，逐步减少保护"], cp: ["只练成熟动作，不学新难度"], taper: ["少量成功率高的动作"] },
        routine: { t: "成套练习", gp: ["半套或分段"], sp: ["完整成套 2–4 次"], cp: ["模拟比赛：热身、候场、成套、评分"], taper: ["1–2 次完整成套"] },
        physical: { t: "专项体能", gp: ["上肢支撑、核心、弹跳力量"], sp: ["爆发力与专项力量"], cp: ["维持"], taper: ["灵活性"] },
        mental: { t: "心理与编排", gp: ["表象训练、呼吸调节"], sp: ["编排与音乐（艺术项目）"], cp: ["比赛情境模拟、应对失误练习"], taper: ["放松与自信建立"] },
        rec: { t: "恢复", gp: ["拉伸、按摩、冷热水交替"], sp: ["恢复"], cp: ["恢复"], taper: ["恢复"] },
      },
      week: { gp: ["basics", "skills", "physical", "basics", "skills", "mental"], sp: ["basics", "skills", "routine", "physical", "routine", "mental"], cp: ["basics", "routine", "rec", "routine", "mental", "rec"], taper: ["basics", "routine", "rec", "mental", "rec", "rec"] },
    },
    net: {
      name: "隔网对抗性（排球、羽毛球、网球、乒乓球）",
      traits: "间歇性高强度：短时爆发 + 回合间恢复；技术精度、判断与移动速度决定胜负，反复跳跃/挥拍带来特定劳损。",
      priorities: ["技术在高速和疲劳下保持精度", "移动步法与反应速度", "跳跃力量与肩、膝、踝的预防训练同样重要"],
      tests: ["助跑摸高 / 纵跳（排球）", "T 型跑、专项多点移动计时", "反应时", "发球/击球成功率统计"],
      prehab: ["肩袖（扣球、发球、挥拍）：外旋力量与肩胛稳定", "髌腱（排球“跳跃膝”）：跳跃总量管理", "踝扭伤（落地踩脚）：平衡与本体感觉训练"],
      lib: {
        skill: { t: "专项技术", gp: ["基本技术规范化（发、接、传、扣 / 挥拍动作）"], sp: ["技术组合与多球训练，接近比赛速度"], cp: ["技术在对抗中运用"], taper: ["短时高质量技术"] },
        tactic: { t: "战术与对抗", gp: ["小场地对抗"], sp: ["专项战术演练（进攻组合、站位、线路）"], cp: ["教学比赛、针对对手的战术准备"], taper: ["战术复习"] },
        jump: { t: "跳跃与爆发", gp: ["基础跳跃、落地技术（每课约 80 次触地）"], sp: ["助跑起跳、跳深、负重跳"], cp: ["少量高质量跳跃"], taper: ["几次最大努力跳"] },
        footwork: { t: "移动与敏捷", gp: ["步法基本功"], sp: ["多点移动、反应启动"], cp: ["专项移动结合技术"], taper: ["短时敏捷"] },
        strength: { t: "力量与预防", gp: ["下肢力量、肩袖外旋、核心"], sp: ["力量维持 + 肩袖/踝预防"], cp: ["维持性预防"], taper: ["灵活性"] },
        rec: { t: "恢复", gp: ["低强度有氧 + 拉伸"], sp: ["恢复"], cp: ["恢复与视频复盘"], taper: ["恢复"] },
      },
      week: { gp: ["skill", "strength", "footwork", "skill", "jump", "tactic"], sp: ["skill", "jump", "tactic", "strength", "footwork", "tactic"], cp: ["skill", "tactic", "rec", "tactic", "jump", "rec"], taper: ["skill", "tactic", "rec", "skill", "rec", "rec"] },
    },
    field: {
      name: "同场对抗性（篮球、足球）",
      traits: "长时间间歇性运动：多次冲刺、变向、跳跃与身体对抗，有氧基础决定重复冲刺后的恢复速度。",
      priorities: ["重复冲刺能力与有氧基础并重", "变向与落地技术（前交叉韧带预防）", "技战术训练与体能训练整合，避免总负荷叠加过高"],
      tests: ["Yo-Yo 间歇恢复测试", "10 米 / 30 米冲刺", "变向测试（如 505）", "纵跳"],
      prehab: ["前交叉韧带：落地与变向技术、神经肌肉训练", "腘绳肌：北欧挺", "内收肌（足球）：哥本哈根侧桥"],
      lib: {
        tech: { t: "技战术", gp: ["个人技术与小组配合"], sp: ["全队战术、攻防转换"], cp: ["针对对手的战术准备、定位球"], taper: ["战术复习"] },
        rsa: { t: "重复冲刺与有氧", gp: ["有氧间歇（如 4×4 分钟高强度）"], sp: ["重复冲刺 6–10×20–30 米，组间 20–30 秒"], cp: ["小场地高强度对抗"], taper: ["短冲刺保持速度"] },
        cod: { t: "变向与落地", gp: ["落地与变向技术定型"], sp: ["反应式变向"], cp: ["专项变向"], taper: ["少量"] },
        strength: { t: "力量", gp: ["深蹲、硬拉、单腿力量 3–4×6–8"], sp: ["爆发力：高翻、跳跃"], cp: ["维持 1 次/周"], taper: ["灵活性"] },
        prehab: { t: "预防", gp: ["北欧挺、哥本哈根侧桥、平衡"], sp: ["维持"], cp: ["赛前激活"], taper: ["激活"] },
        rec: { t: "恢复", gp: ["恢复性训练"], sp: ["赛后恢复课"], cp: ["比赛日次日恢复"], taper: ["恢复"] },
      },
      week: { gp: ["tech", "strength", "rsa", "tech", "prehab", "cod"], sp: ["tech", "rsa", "strength", "tech", "cod", "prehab"], cp: ["tech", "rsa", "rec", "tech", "prehab", "rec"], taper: ["tech", "rec", "tech", "rec", "rec", "rec"] },
    },
  };

  function focusFromHits(ids) {
    const f = new Set();
    for (const id of ids || []) {
      if (id === "SP-01") { f.add("reactive"); f.add("tech"); }
      if (id === "SP-02" || id === "SP-03") f.add("tech");
      if (id === "SP-04") f.add("strength");
      if (id === "CL-01" || id === "CL-03") f.add("tech");
      if (id === "CL-02") { f.add("power"); f.add("strength"); }
    }
    return [...f];
  }

  function plan(a, P, today = new Date()) {
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));           // 本周一
    const goal = a.goalDate ? new Date(a.goalDate) : null;
    let weeks = goal ? Math.ceil((goal - start) / (7 * 864e5)) : 12;
    weeks = clamp(weeks || 12, 4, 52);
    const sessions = clamp(a.sessionsPerWeek || 4, 3, 6);
    const focus = [...new Set([...(P.weakest || []), ...(a.focus || [])])];
    // 各阶段周数
    const counts = PHASES.map(p => Math.max(1, Math.round(weeks * p.share)));
    let diff = weeks - counts.reduce((s, x) => s + x, 0);
    for (let i = 0; diff !== 0; i = (i + 1) % 3) { if (diff > 0) { counts[i]++; diff--; } else if (counts[i] > 1) { counts[i]--; diff++; } }
    const sport = a.sport && root.SPORTLIB ? root.SPORTLIB.byId(a.sport) : null;
    const G = sport && sport.group !== "speed" ? GROUP_PLANS[sport.group] : null;
    const W = [];
    let wi = 0;
    PHASES.forEach((p, pi) => {
      for (let k = 0; k < counts[pi]; k++, wi++) {
        const deload = p.key !== "taper" && (k + 1) % 4 === 0;
        const test = deload || (p.key !== "taper" && k === counts[pi] - 1);
        const ws = new Date(start); ws.setDate(ws.getDate() + wi * 7);
        const slots = DAY_SLOTS[sessions];
        const tpl = TEMPLATES[p.key];
        const days = G ? slots.map((dow, si) => {
          if (test && si === slots.length - 1) return { dow, day: WEEKDAY[dow], blocks: [{ t: "测试日", items: G.tests.slice(0, 3).concat(["结果录入档案，计划自动更新"]) }] };
          const L = G.lib[G.week[p.key][si % G.week[p.key].length]];
          const items = (L[p.key] || []).slice();
          if (deload) items.push("调整周：训练量约为平时的 60%");
          return { dow, day: WEEKDAY[dow], blocks: [{ t: L.t, items }] };
        }) : slots.map((dow, si) => {
          let types = tpl[si % tpl.length].slice();
          if (focus.includes("speed") && p.key === "sp" && types[0] === "tempo" && si > 1) types = ["maxv"];
          if (test && si === slots.length - 1) types = ["test"];
          if (types.includes("nordic") === false && types.includes("str") && p.key !== "taper") types.push("nordic");
          const blocks = types.map(t => t === "test"
            ? { t: "测试日", items: ["30 米行进间跑、30 米起跑、立定跳远；力量课估测深蹲", "结果录入档案，计划自动更新"] }
            : content(t, p.key, deload, focus)).map(b => ({ t: b.t, items: b.items.filter(Boolean) }));
          return { dow, day: WEEKDAY[dow], blocks };
        });
        W.push({ index: wi, start: ws.toISOString().slice(0, 10), phase: p.key, phaseName: p.name, deload, test, days });
      }
    });
    const phases = PHASES.map((p, i) => ({ key: p.key, name: p.name, goal: p.goal, weeks: counts[i] }));
    return { weeks: W, phases, focus, sessions, total: weeks, group: G, sport, refs: G ? ["issurin2010", "gabbett2016"] : ["issurin2010", "haugen2019", "rumpf2016"] };
  }

  const API = { REFS, ELITE, TESTS, DEFAULT_TARGETS, RT, TAU_DEFAULT, xAt, tAt, vmaxFor100, tauFrom30,
    latestTests, profile, insights, plan, readiness, loadRatio, focusFromHits, WEEKDAY, PHASES, GROUP_PLANS };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.COACH = API;
})(typeof self !== "undefined" ? self : this);
