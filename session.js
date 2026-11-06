/* 一分钟备课（v2.3）：把训练计划里的一天变成一堂能直接上的课
   - 课的内容来自周期计划和大脑诊断（不是按主题从练习库里挑），只做“排”：顺序、时间、器材、场地、当天状态
   - 按可用时间压缩：先压次要内容，压的是组数，不压组间休息；实在放不下就去掉次要内容，并说明
   - 教练改动后自检：顺序、热身、总时长、负荷与计划的差距、当天状态
   - 场边模式按时间线走，结束时记录 RPE 和实际时长，回到负荷监控
   参考：同类备课工具（如足球教练用的练习库 + 拖拽排课）省掉的是画图和排版；本模块省掉的是“排”，判断仍由教练做 */
(function (root) {
  const C = typeof module !== "undefined" && module.exports ? require("./coach.js") : root.COACH;
  const isF = Number.isFinite;
  const up5 = m => Math.ceil(m / 5) * 5;
  const r5 = m => Math.max(5, Math.round(m / 5) * 5);

  // 课内顺序（经验原则，见知识库“课内顺序”）：神经要求高的在前，疲劳的在后
  const PARTS = {
    warm: { name: "热身", rank: 0 },
    neural: { name: "速度与技术", rank: 1 },
    skill: { name: "专项与对抗", rank: 1.5 },
    power: { name: "力量与爆发", rank: 2 },
    energy: { name: "耐力与恢复", rank: 3 },
    support: { name: "预防与核心", rank: 4 },
    cool: { name: "放松", rank: 5 },
  };
  const KIND = [
    [/^灵活性$/, "warm"],                                        // 灵活性重点放进热身
    [/加速|最高速度|^速度$|移动与敏捷|变向|难度动作|专项技术|^技术$|基本功/, "neural"],
    [/技战术|战术与对抗|成套|比赛|测试/, "skill"],
    [/快速伸缩|跳跃|爆发|力量|专项体能/, "power"],
    [/速度耐力|节奏跑|乳酸阈|最大摄氧量|长距离|有氧|重复冲刺|恢复/, "energy"],
    [/核心|北欧挺|预防|稳定|心理/, "support"],
  ];
  const baseOf = t => String(t || "").replace(/^(重点|预防)：/, "").replace(/（.*?）/g, "").trim();
  function kindOf(t) {
    if (/^预防：/.test(t)) return "support";
    const b = baseOf(t);
    for (const [re, k] of KIND) if (re.test(b)) return k;
    return "skill";
  }
  const isHigh = t => C.HIGH.test(t) && !/^预防：/.test(t);

  // 器材：缺了就给代替方案（刺激和原计划不同，要说清楚）
  const EQUIP = [
    { k: "barbell", name: "杠铃", re: /深蹲|硬拉|高翻|抓举|挺举|跳耸肩|杠铃/, sub: "没有杠铃：改做单腿蹲或分腿蹲、单腿罗马尼亚硬拉（哑铃或背包负重），高翻改为负重跳或药球后抛；刺激和原计划不同，不要按 1RM 百分比算" },
    { k: "sled", name: "雪橇", re: /雪橇/, sub: "没有雪橇：改为缓坡上坡冲刺 15–20 米" },
    { k: "hurdle", name: "栏架", re: /栏架/, sub: "没有栏架：用标志盘或矮障碍代替，高度降低" },
    { k: "box", name: "跳箱", re: /跳深|跳箱/, sub: "没有跳箱：改为原地落地定型跳；不要从椅子等不稳的东西上跳下" },
    { k: "ball", name: "药球", re: /药球/, sub: "没有药球：改为立定跳远或徒手抛摆动作" },
  ];
  // 直道长度：冲刺类内容需要的直道（含减速），弯道上能完成的耐力跑不算
  function needMeters(text) {
    if (!/冲刺|加速|飞跑|起跑/.test(text)) return 0;
    let need = 0;
    for (const m of text.matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?\s*(?:m|米)/g)) need = Math.max(need, Number(m[2] || m[1]));
    if (/飞跑/.test(text)) return Math.max(60, need) + 10;           // 助跑 20–30 米 + 飞跑 20–30 米 + 减速
    return need ? need + 10 : 0;
  }

  function warmUp(main, o, extra, ctx = {}) {
    const all = main.map(b => b.t + " " + b.items.join(" ")).join(" ");
    const bar = EQUIP[0].re.test(all) && (!ctx.equipment || ctx.equipment.includes("barbell"));
    const hi = main.some(b => b.hi);
    const items = ["慢跑或跳绳 3–5 分钟，身体微微出汗", "动态拉伸：弓步转体、前后和左右摆腿、踝关节绕环"];
    if (/加速|速度|冲刺|飞跑|起跑|变向|敏捷|移动/.test(all)) items.push("跑的专门练习（A 步、小步跑）+ 加速跑 3 次，速度逐次提高（约 60% → 80% → 95%）");
    if (main.some(b => b.kind === "power")) items.push(bar ? "低强度跳跃 2×5；杠铃先做空杆或轻重量 2 组，再上训练重量" : "低强度跳跃 2×5；力量动作先做 1–2 组轻负荷");
    if (o.group === "field" || o.group === "net") items.push("持球或持拍的专项热身，逐渐提高速度");
    if (extra) items.push(extra);
    if (o.R && o.R.level === "yellow") items.push("今天状态一般：热身后看动作质量再定强度，动作变形就停");
    return { kind: "warm", t: "热身", items, min: (hi ? 15 : 10) + (extra ? 5 : 0), rpe: 3, pri: 0, hi: false, notes: [] };
  }
  const coolDown = min => ({ kind: "cool", t: "放松", items: ["慢走或慢跑 3–5 分钟", "主要肌群静态拉伸，各 20–30 秒", "结束后记录 RPE（0–10）和实际时长"], min, rpe: 2, pri: 0, hi: false, notes: [] });

  const CUT_NOTE = {
    neural: "时间压缩：减少组数或次数，组间休息不缩短（缩短休息会把速度课练成耐力课）",
    power: "时间压缩：减少组数，组间休息不缩短，每次仍要全力、动作标准",
    skill: "时间压缩：缩短总时长，强度不变",
    energy: "时间压缩：缩短总时长，强度不变",
    support: "时间压缩：只做最重要的 1–2 个动作",
  };

  // 按可用时间压缩主体：先压次要内容到一半 → 去掉次要内容 → 压第二主项到一半 → 压主项（最多到一半）
  // → 去掉第二主项（大的先去，放到下次课）→ 还放不下就把主项压到放得下（至少 10 分钟，并提示效果有限）
  // → 空出来的时间先还给主项，再还给其他压缩过的内容，不超过计划时长
  // 曾试过“主项不动、直接去掉第二主项”：90 分钟的“加速 + 力量”课会整堂丢掉力量、空出 15 分钟，不合理
  function fit(main, budget) {
    main.forEach((b, i) => { b._o = i; });
    const total = () => main.reduce((s, b) => s + b.min, 0);
    const dropped = [];
    const floorOf = b => Math.max(5, up5(b.plan * 0.5));
    const shrink = b => { const over = total() - budget; if (over > 0) b.min = Math.min(b.min, Math.max(floorOf(b), b.min - up5(over))); };
    const drop = b => { const i = main.indexOf(b); if (i >= 0 && total() > budget) { main.splice(i, 1); dropped.push(b); } };
    const order = pred => main.filter(pred).sort((x, y) => y.pri - x.pri || y.min - x.min);
    if (total() > budget) order(b => b.pri >= 2).forEach(shrink);
    if (total() > budget) order(b => b.pri >= 2).forEach(drop);
    if (total() > budget) [1, 0].forEach(p => main.filter(b => b.pri === p).forEach(shrink));
    if (total() > budget) order(b => b.pri === 1).forEach(drop);
    let squeezed = false;
    if (total() > budget && main.length) {
      const P = main[0] && main.find(b => b.pri === 0) || main[0];
      const room = budget - (total() - P.min);
      P.min = Math.max(10, Math.floor(room / 5) * 5); squeezed = true;
    }
    // 空出来的时间：先把去掉的内容按“重要、短”的顺序放回来，再把压缩过的恢复到计划时长（不超过计划，不临时加量）
    dropped.slice().sort((x, y) => x.pri - y.pri || floorOf(x) - floorOf(y)).forEach(b => {
      if (budget - total() >= floorOf(b)) { b.min = floorOf(b); main.push(b); dropped.splice(dropped.indexOf(b), 1); }
    });
    main.sort((x, y) => x._o - y._o);
    main.slice().sort((x, y) => x.pri - y.pri).forEach(b => { const room = budget - total(); if (room >= 5 && b.min < b.plan) b.min = Math.min(b.plan, b.min + Math.floor(room / 5) * 5); });
    main.forEach(b => delete b._o);
    return { dropped, squeezed };
  }

  const srcOf = day => (day && day.blocks ? day.blocks.map(b => b.t).join("|") : "");

  // day：计划里的一天（coach.plan 的 days[i]）；o：{ minutes, equipment, straight, week, R, F, group, date }
  function build(day, o = {}) {
    const minutes = isF(o.minutes) && o.minutes > 0 ? o.minutes : 90;
    const ctx = { minutes, equipment: Array.isArray(o.equipment) ? o.equipment.slice() : null, straight: isF(o.straight) && o.straight > 0 ? o.straight : null };
    const S = { date: o.date || null, dow: day ? day.dow : null, ctx, blocks: [], dropped: [], notes: [], src: srcOf(day), state: o.R && o.R.level !== "green" && o.R.level !== "none" ? o.R.level : null };
    const W = o.week || {};
    S.title = W.phaseName ? `${isF(W.index) ? `第 ${W.index + 1} 周　` : ""}${W.phaseName}${W.deload ? "　调整周" : ""}` : "";
    if (!day || !day.blocks || day.blocks.every(b => /^休息/.test(b.t))) { S.rest = true; return finish(S, o); }
    const d = o.R ? C.adjustDay(day, o.R) : day;
    const scale = (W.deload ? 0.6 : 1) * (W.ramp || 1);
    const cur = new Set(((o.F && o.F.current) || []).map(x => C.INJURY_RULES[x.part] && C.INJURY_RULES[x.part].name));
    let first = true, extra = null;
    const main = [];
    S.planned = Math.round(day.blocks.filter(b => b.t !== "过渡周" && kindOf(b.t) !== "warm").reduce((s, b) => s + C.blockLoad(b), 0) * scale);
    for (const b of d.blocks) {
      if (b.t === "过渡周") { S.notes.push(...b.items); continue; }
      if (/^休息/.test(b.t)) continue;
      const kind = kindOf(b.t);
      if (kind === "warm") { extra = b.items.join("；"); continue; }
      const addon = /^(重点|预防)：/.test(b.t);
      const L = addon ? [4, 15] : (C.LOAD[baseOf(b.t)] || [5, 45]);
      let min = r5(L[1] * scale), rpe = L[0];
      if (/降强度/.test(b.t)) { min = r5(min * 0.7); rpe = Math.round(rpe * 0.75); }
      const pri = /^预防：/.test(b.t) ? (cur.has(baseOf(b.t)) ? 1 : 2)
        : addon ? 1
        : /北欧挺/.test(b.t) ? 1
        : /核心/.test(b.t) ? 3
        : first ? 0 : 1;
      if (!addon && !/北欧挺|核心/.test(b.t)) first = false;
      main.push({ kind, t: b.t, items: b.items.slice(), min, plan: min, rpe, pri, hi: isHigh(b.t), notes: [] });
    }
    // 器材和场地
    for (const b of main) {
      const text = b.t + " " + b.items.join(" ");
      if (ctx.equipment) for (const E of EQUIP) if (E.re.test(text) && !ctx.equipment.includes(E.k)) b.notes.push(E.sub);
      const need = needMeters(text);
      if (ctx.straight && need > ctx.straight) b.notes.push(`直道只有 ${ctx.straight} 米（这项约需 ${need} 米，含减速）：缩短距离；最高速度练习至少要 20 米助跑，不够就改练加速`);
    }
    // 排序：按课内顺序，稳定排序保留计划里的先后
    main.forEach((b, i) => { b._i = i; });
    main.sort((x, y) => PARTS[x.kind].rank - PARTS[y.kind].rank || x._i - y._i);
    main.forEach(b => delete b._i);
    // 热身、放松与压缩
    const warm = warmUp(main, o, extra, ctx);
    let cool = 10;
    const sumPlan = main.reduce((s, b) => s + b.min, 0);
    S.needMin = warm.min + sumPlan + 10;                         // 按计划完整上完这一天需要的时间（含热身、放松）
    // 时间紧：放松改 5 分钟；热身先去掉附加的 5 分钟，高强度课不足 1 小时才压到 10 分钟
    if (warm.min + cool + sumPlan > minutes) { cool = 5; warm.min = Math.max(minutes < 60 || !main.some(b => b.hi) ? 10 : 15, warm.min - 5); }
    const R = fit(main, minutes - warm.min - cool);
    S.dropped = R.dropped; S.squeezed = R.squeezed;
    for (const b of main) if (b.min < b.plan) b.notes.unshift(CUT_NOTE[b.kind] || CUT_NOTE.skill);
    warm.items = warmUp(main, o, extra, ctx).items;          // 热身内容按压缩后实际保留的内容写（被去掉的力量课不再出现在热身里）
    S.blocks = [warm, ...main, coolDown(cool)];
    return finish(S, o);
  }

  // 重算时长、负荷、空余时间和自检（教练每次改动后调用）
  function finish(S, o = {}) {
    const main = S.blocks.filter(b => b.kind !== "warm" && b.kind !== "cool");
    S.total = S.blocks.reduce((s, b) => s + b.min, 0);
    S.spare = S.ctx.minutes - S.total;
    S.load = { main: Math.round(main.reduce((s, b) => s + b.rpe * b.min, 0)), total: Math.round(S.blocks.reduce((s, b) => s + b.rpe * b.min, 0)), planned: S.planned || 0 };
    S.checks = check(S, o);
    return S;
  }

  function check(S, o = {}) {
    const out = [], warn = text => out.push({ level: "warn", text }), tip = text => out.push({ level: "tip", text });
    if (S.rest) { tip("今天计划休息：完全休息或轻松活动，不用备课"); return out; }
    const main = S.blocks.filter(b => b.kind !== "warm" && b.kind !== "cool");
    const warm = S.blocks.find(b => b.kind === "warm");
    const hi = main.some(b => b.hi);
    if (hi && (!warm || warm.min < 10)) warn(`有高强度内容，热身${warm ? `只有 ${warm.min} 分钟` : "被删掉了"}：建议至少 10 分钟，最后几次加速或跳跃要接近训练强度`);
    if (warm && S.blocks[0] !== warm) warn("热身不在第一项");
    const flagged = new Set();
    for (let j = 0; j < main.length; j++) for (let i = 0; i < j; i++) {
      const A = main[i], B = main[j];
      if (flagged.has(B)) continue;
      if (PARTS[A.kind].rank >= 3 && B.hi && PARTS[B.kind].rank <= 2) {
        flagged.add(B);
        warn(`「${B.t}」排在「${A.t}」之后：累了再练${B.kind === "power" ? "力量和爆发" : "速度和技术"}，质量下降、受伤风险增加。除非你就是要练疲劳下的技术（对抗项目比赛后段），建议调到前面`);
      } else if (A.kind === "power" && B.kind === "neural" && /加速|速度|冲刺/.test(B.t)) {
        flagged.add(B);
        tip(`「${B.t}」排在「${A.t}」之后：大量力量或跳跃后再冲刺，速度会下降；一般先冲刺后力量（少量跳跃做激活可以放前面）`);
      }
    }
    if (S.total > S.ctx.minutes) warn(`总时长 ${S.total} 分钟，超过可用的 ${S.ctx.minutes} 分钟`);
    const L = S.load;
    if (L.planned > 0) {
      const r = L.main / L.planned;
      if (r > 1.2) warn(`主体负荷约 ${L.main}（RPE × 分钟），是计划的 ${r.toFixed(2)} 倍：会让本周负荷超出计划自检的范围`);
      else if (r < 0.7 && !S.state) tip(`${S.needMin > S.ctx.minutes ? `按计划完整上完约需 ${S.needMin} 分钟，可用 ${S.ctx.minutes} 分钟，` : ""}主体负荷是计划的 ${Math.round(r * 100)}%：时间或器材不够时正常，不需要在别的天补`);
    }
    if (o.R && o.R.level === "red" && main.some(b => b.hi)) warn("今天状态差（打卡）：建议只做恢复；你保留了高强度内容，请先确认运动员身体没问题");
    else if (o.R && o.R.level === "yellow" && main.some(b => b.hi && !/降强度/.test(b.t))) tip("今天状态一般：高强度内容建议量减三分之一、强度 80% 以下");
    const cool = S.blocks.find(b => b.kind === "cool");
    if (!cool) tip("没有放松：至少慢走 3–5 分钟再结束");
    else if (S.blocks[S.blocks.length - 1] !== cool) tip("放松不在最后一项");
    if (S.dropped && S.dropped.length) tip(`时间不够，去掉了：${S.dropped.map(b => b.t).join("、")}（放到下一次课，不必硬补）`);
    if (S.squeezed) { const P = main[0]; warn(`可用时间太短：${P ? `「${P.t}」只剩 ${P.min} 分钟（计划 ${P.plan} 分钟），效果有限。` : ""}建议换到时间充足的一天，或今天只做热身 + 主项`); }
    if (S.spare >= 10) tip(`还剩 ${S.spare} 分钟：不必填满，可以多练技术细节或提前结束；临时加量会让本周负荷超出计划`);
    return out;
  }

  // ---------------- 教练修改 ----------------
  const isMain = b => b.kind !== "warm" && b.kind !== "cool";
  function move(S, i, dir, o) {
    const j = i + dir, b = S.blocks[i], c = S.blocks[j];
    if (!b || !c || !isMain(b) || !isMain(c)) return S;
    S.blocks[i] = c; S.blocks[j] = b; S.edited = true;
    return finish(S, o);
  }
  function setMin(S, i, min, o) {
    const b = S.blocks[i]; if (!b) return S;
    b.min = Math.max(0, Math.min(240, Math.round(min / 5) * 5));
    if (b.min === 0) S.blocks.splice(i, 1);
    S.edited = true;
    return finish(S, o);
  }
  function remove(S, i, o) { if (S.blocks[i]) { S.blocks.splice(i, 1); S.edited = true; } return finish(S, o); }
  // 加一项：放到符合课内顺序的位置（教练之后还能再调）
  function add(S, blk, o) {
    const kind = kindOf(blk.t);
    const addon = /^(重点|预防)：/.test(blk.t);
    const L = addon ? [4, 15] : (C.LOAD[baseOf(blk.t)] || [5, 45]);
    const b = { kind: kind === "warm" ? "support" : kind, t: blk.t, items: (blk.items || []).slice(), min: r5(L[1]), plan: r5(L[1]), rpe: L[0], pri: 1, hi: isHigh(blk.t), notes: [], added: true };
    const rank = PARTS[b.kind].rank;
    let at = S.blocks.findIndex(x => x.kind === "cool");
    if (at < 0) at = S.blocks.length;
    for (let i = 0; i < S.blocks.length; i++) if (isMain(S.blocks[i]) && PARTS[S.blocks[i].kind].rank > rank) { at = i; break; }
    S.blocks.splice(at, 0, b); S.edited = true;
    return finish(S, o);
  }

  // 可以加进来的内容：本阶段课表里出现过的课、大脑的训练重点、伤病预防（保证内容符合当前阶段）
  function library(PL, wi, extras = []) {
    const w = PL.weeks[wi]; if (!w) return [];
    const seen = new Map();
    PL.weeks.filter(x => x.phase === w.phase).forEach(x => x.days.forEach(d => d.blocks.forEach(b => {
      if (/^(休息|过渡周|测试日)/.test(b.t) || seen.has(b.t)) return;
      seen.set(b.t, { t: b.t, items: b.items.slice() });
    })));
    extras.forEach(b => { if (!seen.has(b.t)) seen.set(b.t, b); });
    return [...seen.values()];
  }

  // 场边模式的时间线：每一项的开始、结束分钟
  function timeline(S) {
    let t = 0;
    return S.blocks.map((b, i) => { const s = t; t += b.min; return { i, t: b.t, start: s, end: t }; });
  }

  // 训练结束：把 RPE 和实际时长写进当天的记录（保留早上的打卡）
  function logSession(wellness, date, rpe, minutes) {
    const list = (wellness || []).slice();
    const i = list.findIndex(x => x.date === date);
    const e = Object.assign({}, i >= 0 ? list[i] : { date });
    if (isF(rpe) && rpe >= 0 && rpe <= 10) e.rpe = rpe;
    if (isF(minutes) && minutes > 0) e.minutes = Math.round(minutes);
    e.session = true;
    if (i >= 0) list[i] = e; else list.push(e);
    return list.sort((x, y) => (x.date < y.date ? -1 : 1));
  }

  const API = { PARTS, EQUIP, kindOf, baseOf, needMeters, build, finish, check, move, setMin, remove, add, library, timeline, logSession, srcOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.SESSION = API;
})(typeof self !== "undefined" ? self : this);
