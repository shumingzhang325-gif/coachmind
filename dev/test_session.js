// 一分钟备课自测：顺序、按时间压缩、器材与场地、当天状态、教练修改后的自检、场边记录、本地日期
// 要检查“排得对”，也要检查“教练改错时能报出来”“没问题时不乱报”
globalThis.self = globalThis;
const SPORTLIB = require("../sports.js"); globalThis.SPORTLIB = SPORTLIB;
const C = require("../coach.js"); globalThis.COACH = C;
const BRAIN = require("../brain.js"), SE = require("../session.js");
const { execFileSync } = require("child_process");
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const today = new Date(2026, 9, 1, 10, 0);
const plus = days => { const d = new Date(today); d.setDate(d.getDate() + days); return C.ymd(d); };
const ath = (x = {}) => Object.assign({ name: "t", sex: "男", sessionsPerWeek: 4, tests: [], wellness: [], sport: "sprint" }, x);
const addons = Object.fromEntries(Object.entries(BRAIN.CAPS).map(([k, v]) => [k, { name: v.name, addon: v.addon }]));
const mk = (a, focus) => C.plan(a, C.profile(a, null), today, { focus: focus || [], addons });
const rank = b => SE.PARTS[b.kind].rank;
const mainOf = S => S.blocks.filter(b => b.kind !== "warm" && b.kind !== "cool");
const sprintDay = (types) => ({ dow: 0, day: "周一", blocks: types.map(t => ({ t, items: t === "加速" ? ["8 × 30 m 起跑加速，走回恢复约 2–3 分钟", "4 × 20 m 雪橇抗阻冲刺"] : t === "最高速度" ? ["4 × 飞跑 20–30 m（助跑 20–30 m），组间 4–6 分钟完全恢复"] : t === "力量" ? ["深蹲 4×3–5 @ 80–90% 1RM", "高翻或跳耸肩 4×3"] : ["内容"] })) });

console.log("全部项目 × 阶段 × 每周课数 × 可用时间：自动排出的课");
{
  let n = 0;
  const bad = { order: [], time: [], warm: [], warn: [], load: [], small: [] };
  for (const s of SPORTLIB.SPORTS) for (const k of [3, 4, 5, 6]) for (const wk of [3, 12, 30]) {
    const a = ath({ sport: s.id, sessionsPerWeek: k, goalDate: plus(wk * 7), injuries: [{ part: "hamstring", status: "history" }] });
    const PL = mk(a, ["mobility", "stability", "strength"]);
    for (const w of [PL.weeks[0], PL.weeks[Math.floor(PL.weeks.length / 2)], PL.weeks[PL.weeks.length - 1]]) for (const d of w.days) for (const min of [30, 45, 60, 90, 120, 150]) {
      const S = SE.build(d, { minutes: min, week: w, F: PL.factors, group: s.group });
      n++;
      if (S.rest) continue;
      const tag = `${s.name}/${k}次/${w.phaseName}/${d.day}/${min}分`;
      const M = mainOf(S);
      if (S.blocks[0].kind !== "warm" || S.blocks[S.blocks.length - 1].kind !== "cool" || M.some((b, i) => i && rank(M[i - 1]) > rank(b))) bad.order.push(tag);
      if (S.total > min && !S.squeezed) bad.time.push(`${tag} 共 ${S.total}`);
      if (M.some(b => b.hi) && S.blocks[0].min < 10) bad.warm.push(tag);
      if (S.blocks.some(b => b.min < 5)) bad.small.push(tag);
      const w2 = S.checks.filter(c => c.level === "warn" && !/可用时间太短/.test(c.text));
      if (w2.length) bad.warn.push(`${tag}：${w2[0].text}`);
      if (S.load.planned > 0 && S.load.main > S.load.planned * 1.1) bad.load.push(`${tag} ${S.load.main}/${S.load.planned}`);
    }
  }
  const show = x => x.length ? `（${x.slice(0, 3).join("；")}）` : "";
  check(!bad.order.length, `${n} 堂课：热身在前、放松在后，主体按“速度与技术 → 专项 → 力量与爆发 → 耐力 → 预防”排列${show(bad.order)}`);
  check(!bad.time.length, `总时长不超过可用时间（放不下时明确提示“时间太短”）${show(bad.time)}`);
  check(!bad.warm.length, `有高强度内容时热身至少 10 分钟${show(bad.warm)}`);
  check(!bad.small.length, `没有短于 5 分钟的内容${show(bad.small)}`);
  check(!bad.warn.length, `自动排出的课不触发自己的警告（不误报）${show(bad.warn)}`);
  check(!bad.load.length, `只压缩、不加量：主体负荷不超过计划${show(bad.load)}`);
}

console.log("\n按时间压缩");
{
  const day = sprintDay(["加速", "力量", "北欧挺", "核心与灵活性"]);
  const full = SE.build(day, { minutes: 200 });
  check(mainOf(full).every(b => b.min === b.plan) && full.checks.some(c => /不必填满/.test(c.text)), `时间充足（200 分钟）：不拉长任何内容，提示“不必填满、不要临时加量”`);
  const S = SE.build(day, { minutes: 90 });
  const acc = S.blocks.find(b => b.t === "加速");
  const str = S.blocks.find(b => b.t === "力量");
  check(S.dropped.some(b => b.t === "核心与灵活性"), `90 分钟：先去掉次要内容（核心与灵活性）`);
  check(acc && str && acc.min / acc.plan >= str.min / str.plan && S.blocks[0].min >= 15, `主项“加速”保留的比例（${acc && acc.min}/${acc && acc.plan}）不低于第二主项“力量”（${str && str.min}/${str && str.plan}），热身仍有 ${S.blocks[0].min} 分钟`);
  const g90 = SE.build(sprintDay(["加速", "力量"]), { minutes: 90 });
  check(g90.blocks.some(b => b.t === "力量") && g90.spare < 5, `90 分钟的“加速 + 力量”课：两项都保留、各自减量，不整堂丢掉力量、不空出大段时间`);
  const cut = S.blocks.filter(b => b.min < (b.plan || 0));
  check(cut.length && cut.every(b => b.notes.some(n => /时间压缩/.test(n))) && cut.filter(b => b.kind === "neural" || b.kind === "power").every(b => b.notes.some(n => /休息不缩短/.test(n))), `被压缩的内容都写明怎么压：速度、力量课减组数，不缩短组间休息`);
  const S40 = SE.build(day, { minutes: 40 });
  check(S40.total <= 40 && S40.squeezed && S40.checks.some(c => c.level === "warn" && /时间太短/.test(c.text)), `40 分钟：仍控制在 40 分钟内，并警告“时间太短，效果有限”`);
  check(S40.checks.some(c => /去掉了/.test(c.text)), `去掉的内容列出来，提示不必硬补`);
  const noStr = SE.build(sprintDay(["加速", "力量"]), { minutes: 45, equipment: [] });
  check(!noStr.blocks.some(b => b.t === "力量") ? !noStr.blocks[0].items.some(i => /杠铃|力量动作/.test(i)) : true, `力量课被去掉后，热身里不再出现力量/杠铃的热身组`);
  const noBar = SE.build(sprintDay(["加速", "力量"]), { minutes: 200, equipment: ["sled"] });
  check(!noBar.blocks[0].items.some(i => /杠铃/.test(i)) && noBar.blocks[0].items.some(i => /轻负荷/.test(i)), `没有杠铃：热身不写“杠铃空杆”，改为轻负荷热身组`);
  const nord = SE.build(sprintDay(["加速", "力量", "北欧挺"]), { minutes: 60 });
  check(nord.blocks.some(b => b.t === "北欧挺") && !nord.blocks.some(b => b.t === "力量"), `60 分钟放不下两项主课：去掉大的（力量），保留 10 分钟的北欧挺`);
}

console.log("\n器材与场地");
{
  const day = sprintDay(["加速", "最高速度", "力量"]);
  const all = SE.build(day, { minutes: 200 });
  check(all.blocks.every(b => !b.notes.some(n => /没有/.test(n))), `器材未指定（默认都有）：不提示代替`);
  const none = SE.build(day, { minutes: 200, equipment: [] });
  const str = none.blocks.find(b => b.t === "力量"), acc = none.blocks.find(b => b.t === "加速");
  check(str.notes.some(n => /没有杠铃/.test(n) && /不要按 1RM/.test(n)), `没有杠铃：力量课给出代替动作，并说明刺激不同、不能按 1RM 算`);
  check(acc.notes.some(n => /没有雪橇/.test(n)), `没有雪橇：抗阻冲刺改为上坡冲刺`);
  const has = SE.build(day, { minutes: 200, equipment: ["barbell", "sled"] });
  check(!has.blocks.some(b => b.notes.some(n => /没有/.test(n))), `器材齐全：不提示`);
  const short = SE.build(day, { minutes: 200, straight: 40 });
  check(short.blocks.find(b => b.t === "最高速度").notes.some(n => /直道只有 40 米/.test(n)), `直道 40 米：飞跑（约需 70 米）提示缩短或改练加速`);
  check(!short.blocks.find(b => b.t === "加速").notes.some(n => /直道/.test(n)), `直道 40 米：30 米起跑加速（约需 40 米）不误报`);
  check(SE.needMeters("6 × 100 m @ 约 70% 速度") === 0, `节奏跑可以在弯道上跑：不要求直道`);
}

console.log("\n当天状态");
{
  const day = sprintDay(["加速", "力量"]);
  const y = SE.build(day, { minutes: 90, R: { level: "yellow" } });
  check(mainOf(y).every(b => /降强度/.test(b.t)) && y.blocks[0].items.some(i => /状态一般/.test(i)), `状态一般：高强度内容降强度，热身里提醒看动作质量`);
  check(y.load.main < SE.build(day, { minutes: 90 }).load.main, `状态一般：负荷低于正常日`);
  const r = SE.build(day, { minutes: 90, R: { level: "red" } });
  check(mainOf(r).length === 1 && /恢复/.test(mainOf(r)[0].t) && !mainOf(r)[0].hi, `状态差：整堂课换成恢复`);
  const t = C.adjustDay({ dow: 0, blocks: [{ t: "测试日", items: ["30 米行进间跑"] }] }, { level: "yellow" });
  check(/建议改天/.test(t.blocks[0].t), `测试日遇到状态一般：建议改天测（成绩不代表真实水平）`);
  const race = { dow: 4, blocks: [{ t: "比赛或测试", items: ["比赛日 / 测试日"] }] };
  const ry = C.adjustDay(race, { level: "yellow" }), rr = C.adjustDay(race, { level: "red" });
  check(ry.blocks[0].t === "比赛或测试" && /比赛照常/.test(ry.blocks[0].items[0]) && rr.blocks[0].t === "比赛或测试" && /队医/.test(rr.blocks[0].items[0]), `比赛日状态一般或差：不改期、不换成恢复课，只提醒（测试可以改天）`);
  const g = C.adjustDay({ dow: 0, blocks: [{ t: "速度", items: ["20–30 米加速跑 6–8 次"] }, { t: "变向与落地", items: ["反应式变向"] }] }, { level: "yellow" });
  check(g.blocks.every(b => /降强度/.test(b.t)), `快速力量项群的“速度”课和“变向”课也会降强度（v2.2 以前漏掉）`);
}

console.log("\n教练修改后的自检");
{
  const day = sprintDay(["最高速度", "力量"]);
  const base = () => SE.build(day, { minutes: 150 });
  const S0 = base();
  check(!S0.checks.some(c => c.level === "warn"), `原样：没有警告`);
  const S1 = SE.add(base(), { t: "节奏跑", items: ["8 × 100 m @ 约 70%"] });
  const iT = S1.blocks.findIndex(b => b.t === "节奏跑");
  check(iT > S1.blocks.findIndex(b => b.t === "力量"), `加一项“节奏跑”：自动放在力量之后`);
  let S2 = S1; const iSp = S2.blocks.findIndex(b => b.t === "最高速度");
  S2 = SE.move(S2, iT, -1); S2 = SE.move(S2, iT - 1, -1);
  check(S2.blocks.findIndex(b => b.t === "节奏跑") < S2.blocks.findIndex(b => b.t === "最高速度") && S2.checks.some(c => c.level === "warn" && /最高速度/.test(c.text) && /累了/.test(c.text)), `把节奏跑挪到最高速度前面：警告“累了再练速度”`);
  const S3 = SE.remove(base(), 0);
  check(S3.checks.some(c => c.level === "warn" && /热身/.test(c.text)), `删掉热身：警告`);
  const S4 = SE.setMin(base(), 0, 5);
  check(S4.checks.some(c => c.level === "warn" && /热身只有 5 分钟/.test(c.text)), `热身改成 5 分钟：警告`);
  const S5 = SE.setMin(base(), 1, 120);
  check(S5.checks.some(c => /超过可用/.test(c.text)) && S5.checks.some(c => /是计划的 .* 倍/.test(c.text)), `最高速度改成 120 分钟：警告超时、负荷超出计划`);
  const S6 = SE.build(day, { minutes: 150 }); S6.blocks.reverse(); SE.finish(S6);
  check(S6.checks.some(c => c.level === "warn" && /热身不在第一项/.test(c.text)) && S6.checks.some(c => /放松不在最后/.test(c.text)), `顺序整个倒过来：报出热身不在第一项、放松不在最后`);
  const S7 = SE.build(day, { minutes: 150 });
  const sw = SE.move(S7, 1, 1);
  check(sw.checks.some(c => c.level === "tip" && /先冲刺后力量/.test(c.text)) && !sw.checks.some(c => c.level === "warn"), `力量挪到最高速度前：只提示（不算错误，有人用少量跳跃做激活）`);
  const red = SE.finish(base(), { R: { level: "red" } });
  check(red.checks.some(c => c.level === "warn" && /状态差/.test(c.text)), `打卡状态差、教练仍保留高强度：警告`);
  check(SE.move(base(), 0, 1).blocks[0].kind === "warm", `热身和放松不参与上下移动`);
}

console.log("\n可以加进来的内容（本阶段课表）");
{
  const a = ath({ goalDate: plus(84), injuries: [{ part: "knee", status: "current" }] });
  const PL = mk(a, ["stability"]);
  const lib = SE.library(PL, 0, [{ t: "重点：稳定与落地控制", items: ["单腿站立"] }]);
  check(lib.length >= 3 && !lib.some(b => /^(休息|过渡周|测试日)/.test(b.t)), `${lib.length} 项，不含休息、过渡说明和测试日`);
  check(lib.every(b => PL.weeks.some(w => w.phase === PL.weeks[0].phase && w.days.some(d => d.blocks.some(x => x.t === b.t))) || /^重点/.test(b.t)), `都来自本阶段的课表或大脑的训练重点`);
}

console.log("\n场边模式与记录");
{
  const S = SE.build(sprintDay(["加速", "力量"]), { minutes: 90 });
  const T = SE.timeline(S);
  check(T[0].start === 0 && T[T.length - 1].end === S.total && T.every((x, i) => !i || x.start === T[i - 1].end), `时间线连续，结束于第 ${S.total} 分钟`);
  const W = [{ date: "2026-10-01", sleep: 7.5, fatigue: 2, soreness: 3, hrRest: 55 }];
  const L = SE.logSession(W, "2026-10-01", 7, 84.4);
  check(L.length === 1 && L[0].rpe === 7 && L[0].minutes === 84 && L[0].sleep === 7.5 && L[0].hrRest === 55 && W[0].rpe === undefined, `训练后记录 RPE 7、84 分钟：保留早上打卡，不改原数组`);
  const L2 = SE.logSession([], "2026-10-01", 6, 60);
  check(L2.length === 1 && L2[0].rpe === 6, `早上没打卡：新建一条只有 RPE 和时长的记录`);
  const R = C.readiness(ath({ wellness: L2 }), today);
  check(R.level === "none", `只有训练后记录、没有早上打卡：状态显示“还没打卡”，不当成“状态良好”（v2.2 以前会误判为良好）`);
  const a = ath({ wellness: Array.from({ length: 28 }, (_, i) => ({ date: plus(-27 + i), rpe: 5, minutes: 60, session: true })) });
  check(Math.abs(C.loadRatio(a, today) - 1) < 0.01, `场边记录进入急慢性负荷比计算（每天一样 → 1.00）`);
  const morning = Array.from({ length: 5 }, (_, i) => ({ date: plus(-5 + i), sleep: 8, fatigue: 2, soreness: 2 }));
  const both = morning.map(w => Object.assign({}, w, { rpe: 6, minutes: 70 })).concat(Array.from({ length: 4 }, (_, i) => ({ date: plus(-12 + i), rpe: 6, minutes: 70, session: true })));
  const rpeOnly = ath({ wellness: Array.from({ length: 6 }, (_, i) => ({ date: plus(-6 + i), rpe: 6, minutes: 70, session: true })).concat(morning.slice(0, 0)) });
  const B1 = BRAIN.reason(rpeOnly, [], C.profile(rpeOnly, null), { today });
  check(!B1.priorities.some(p => p.key === "recovery"), `只有训练后记录（没有睡眠）：大脑不把它当成“睡眠 0 小时”、不误报恢复不足（修复前会）`);
  const mix = ath({ wellness: both.concat([{ date: plus(-1), rpe: 7, minutes: 80, session: true }]) });
  const txt = JSON.stringify(C.insights(mix, C.profile(mix, null), null)) + JSON.stringify(C.profile(mix, null).radar);
  check(!/NaN/.test(txt), `早上打卡和训练后记录混在一起：画像和分析里没有 NaN`);
}

console.log("\n本地日期（北京时间、洛杉矶时间）");
{
  const probe = `globalThis.self=globalThis;globalThis.SPORTLIB=require(${JSON.stringify(require.resolve("../sports.js"))});const C=require(${JSON.stringify(require.resolve("../coach.js"))});
    const now=new Date(2026,10,9,7,0);const a={name:"t",sex:"男",sessionsPerWeek:4,tests:[],wellness:[{date:C.ymd(now),sleep:8,fatigue:2,soreness:2}],planStart:"2026-11-09"};
    const PL=C.plan(a,C.profile(a,null),now);console.log(JSON.stringify({today:C.ymd(now),start:PL.weeks[0].start,dow:C.parseYmd(PL.weeks[0].start).getDay(),r:C.readiness(a,now).level}));`;
  for (const tz of ["Asia/Shanghai", "America/Los_Angeles", "UTC"]) {
    const out = JSON.parse(execFileSync(process.execPath, ["-e", probe], { env: Object.assign({}, process.env, { TZ: tz }) }).toString());
    check(out.today === "2026-11-09" && out.start === "2026-11-09" && out.dow === 1 && out.r === "green", `${tz} 早上 7 点：今天是 ${out.today}，计划第 1 周从周一 ${out.start} 开始，早上的打卡算今天`);
  }
}

console.log(fail ? `\n${fail} 项失败 ✗` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
