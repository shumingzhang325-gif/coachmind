// 训练计划自测：周期按日期推进、负荷不骤增、大脑重点进入所有项目的计划、年龄/训练年限/伤病/当天状态都生效
globalThis.self = globalThis;
const SPORTLIB = require("../sports.js"); globalThis.SPORTLIB = SPORTLIB;
const C = require("../coach.js"), BRAIN = require("../brain.js");
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const today = new Date("2026-10-01T10:00:00");
const iso = d => d.toISOString().slice(0, 10);
const plus = days => { const d = new Date(today); d.setDate(d.getDate() + days); return iso(d); };
const ath = (x = {}) => Object.assign({ name: "t", sex: "男", sessionsPerWeek: 4, tests: [], wellness: [], sport: "sprint" }, x);
const mk = (a, opts) => C.plan(a, C.profile(a, null), today, opts);
const curWeek = PL => { let k = 0; PL.weeks.forEach((w, i) => { if (new Date(w.start) <= today) k = i; }); return PL.weeks[k]; };
const allItems = PL => PL.weeks.flatMap(w => w.days.flatMap(d => d.blocks.flatMap(b => b.items)));
const addonsFrom = () => Object.fromEntries(Object.entries(BRAIN.CAPS).map(([k, v]) => [k, { name: v.name, addon: v.addon }]));

console.log("周期按日期推进（旧版：今天永远是第 1 周“一般准备期”）");
{
  const PL = mk(ath({ planStart: plus(-70), goalDate: plus(6) }));
  check(curWeek(PL).phase === "taper", `计划 10 周前开始、比赛在 6 天后：本周是“${curWeek(PL).phaseName}”`);
  const PL2 = mk(ath({ goalDate: plus(5) }));
  check(PL2.weeks.every(w => w.phase === "taper"), `没有起始日、比赛在 5 天后（下周）：${PL2.weeks.length} 周全部是调整比赛期`);
  const PL3 = mk(ath({ planStart: plus(-35), goalDate: plus(50) }));
  check(curWeek(PL3).phase !== "gp" || PL3.phases[0].weeks > 5, `计划已进行 5 周：本周是“${curWeek(PL3).phaseName}”，不再停在第 1 周`);
  const PL4 = mk(ath({ planStart: plus(-100) }));
  const cw = curWeek(PL4); check(PL4.weeks.length === 12 && new Date(cw.start) <= today && (today - new Date(cw.start)) < 7 * 864e5, `没有目标日期：每 12 周一个循环，本周在计划里`);
  const past = mk(ath({ goalDate: plus(-3) }));
  check(past.weeks.length === 12, `目标日期已过：按无目标处理`);
}

console.log("\n负荷自检（急性/慢性负荷比 ≤ 1.3）");
{
  let n = 0, bad = [], max = 0;
  for (const s of SPORTLIB.SPORTS) for (const k of [3, 4, 5, 6]) for (const wk of [2, 5, 12, 20, 40]) {
    const PL = mk(ath({ sport: s.id, sessionsPerWeek: k, goalDate: plus(wk * 7) })); n++;
    if (!PL.load.ok) bad.push(`${s.name}/${k}/${wk}`); max = Math.max(max, PL.load.max || 0);
    if (!PL.weeks.every(w => w.days.length === k)) bad.push(`${s.name}/${k} 每周课数不对`);
  }
  check(!bad.length, `${n} 个计划都没有负荷骤增，最大 ${max}${bad.length ? "（" + bad.slice(0, 5).join("，") + "）" : ""}`);
}

console.log("\n大脑判断的重点进入所有项目的计划（旧版：除短跑外都不生效）");
for (const sport of ["volleyball", "distance", "gymnastics", "sprint"]) {
  const PL = mk(ath({ sport, goalDate: plus(84) }), { focus: ["mobility", "stability"], addons: addonsFrom() });
  const w = PL.weeks.find(x => x.phase !== "taper" && !x.deload), dl = PL.weeks.find(x => x.deload), tp = PL.weeks.find(x => x.phase === "taper");
  const cnt = (W, name) => W.days.reduce((s, d) => s + d.blocks.filter(b => b.t === "重点：" + name).length, 0);
  check(cnt(w, "灵活性（踝、髋）") === 2 && cnt(w, "稳定与落地控制") === 2, `${SPORTLIB.byId(sport).name}：普通周灵活性、稳定各 2 次`);
  check(!dl || cnt(dl, "灵活性（踝、髋）") === 1, `${SPORTLIB.byId(sport).name}：调整周减为 1 次`);
  check(cnt(tp, "灵活性（踝、髋）") === 0, `${SPORTLIB.byId(sport).name}：调整比赛期不加`);
}

console.log("\n年龄与训练年限");
{
  const youth = mk(ath({ birthYear: 2012, goalDate: plus(120) })), adult = mk(ath({ birthYear: 1998, goalDate: plus(120) }));
  check(allItems(adult).some(t => /跳深/.test(t)) && !allItems(youth).some(t => /跳深/.test(t) && !/暂不做跳深/.test(t)), `14 岁：计划里没有跳深（成年人有）`);
  check(allItems(youth).some(t => /用能完成 8 次以上的重量/.test(t)), `14 岁：力量课改为动作质量优先`);
  const novice = mk(ath({ trainingYears: 1, sport: "weightlifting", goalDate: plus(120) }));
  check(allItems(novice).some(t => /训练不足 2 年/.test(t)), `训练 1 年：力量和跳跃内容有调整说明`);
  check(youth.notes.some(n => /青少年/.test(n)), `计划说明里写明青少年调整`);
}

console.log("\n伤病");
{
  const knee = mk(ath({ sport: "volleyball", goalDate: plus(84), injuries: [{ part: "knee", status: "current" }] }));
  const items = allItems(knee);
  check(items.some(t => /膝伤：跳跃量减半/.test(t)), `当前膝伤：跳跃内容加注减量`);
  check(!items.some(t => /跳深/.test(t) && !/跳深（|暂不做跳深|不做跳深/.test(t)), `当前膝伤：没有跳深`);
  check(knee.weeks.every(w => w.days.some(d => d.blocks.some(b => b.t === "预防：膝"))), `每周都有膝关节预防练习`);
  const ham = mk(ath({ goalDate: plus(84), injuries: [{ part: "hamstring", status: "history" }] }));
  check(ham.weeks.every(w => w.days.some(d => d.blocks.some(b => b.t === "预防：腘绳肌"))) && !allItems(ham).some(t => /腘绳肌伤后/.test(t)), `既往腘绳肌伤：每周加预防，但不按伤后限制速度`);
  check(knee.notes.some(n => /队医或康复师/.test(n)), `计划说明提示需队医或康复师确认`);
}

console.log("\n当天状态");
{
  const day = { dow: 0, day: "周一", blocks: [{ t: "最高速度", items: ["4 × 飞跑 30 m"] }, { t: "核心与灵活性", items: ["平板支撑"] }] };
  const y = C.adjustDay(day, { level: "yellow" }), r = C.adjustDay(day, { level: "red" }), g = C.adjustDay(day, { level: "green" });
  check(/降强度/.test(y.blocks[0].t) && y.blocks[1].t === "核心与灵活性", `状态一般：高强度课降强度，低强度课不变`);
  check(r.blocks.length === 1 && /恢复/.test(r.blocks[0].t), `状态差：改为恢复课`);
  check(g === day, `状态好：按原计划`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
