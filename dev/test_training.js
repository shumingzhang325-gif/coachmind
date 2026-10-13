// 动作建议与训练规划（feat/training-plan）：处方带量与出处、三段式、诊断进下周课表、空项、调整周真降量、减量期封顶、3+1 渐进、测试进步不足保持原量
globalThis.self = globalThis;
const SPORTLIB = require("../sports.js"); globalThis.SPORTLIB = SPORTLIB;
const C = require("../coach.js");
const { CARDS } = require("./data_node.js");
const fs = require("fs");
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const today = new Date("2026-10-01T10:00:00");
const plus = n => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ath = (x = {}) => Object.assign({ name: "t", sex: "男", sessionsPerWeek: 4, tests: [], wellness: [], sport: "sprint" }, x);
const mk = (a, o) => C.plan(a, C.profile(a, null), today, o);
const items = W => W.days.flatMap(d => d.blocks.flatMap(b => b.items));
const blocks = W => W.days.flatMap(d => d.blocks);

console.log("1/5 诊断卡处方");
{
  const all = CARDS.cards.flatMap(c => Object.values(c.prescriptions));
  check(!all.some(t => /^见 [A-Z]{2}-\d+/.test(t)), "没有“见 SP-02”式的交叉引用，直接写出处方");
  const sp01 = CARDS.cards.find(c => c.id === "SP-01").prescriptions;
  check(/80–100/.test(sp01.A) && /每周 1–2 次/.test(sp01.A) && /6–8 周/.test(sp01.A), "SP-01 A：触地分级、每周 1–2 次、6–8 周");
  check(/直腿跑/.test(sp01.B), "SP-01 B：直接给出 SP-02 A 的处方");
  check(/60–90 分钟/.test(CARDS.cards.find(c => c.id === "GN-01").prescriptions.A), "GN-01：Hewett 6 周方案");
  check(/\+5% 到 \+10%/.test(CARDS.cards.find(c => c.id === "SP-02").prescriptions.B), "SP-02 B：节拍器 +5～10%");
  check(CARDS.cards.filter(c => /^CL/.test(c.id)).every(c => /暂无可靠依据/.test(c.prescriptions.A)), "举重负荷没出处：写“暂无可靠依据”");
  const eng = fs.readFileSync(__dirname + "/../engine.js", "utf8");
  check(eng.includes(JSON.stringify(sp01.A).slice(1, 30)), "engine.js 与 data_node.js 的知识卡一致");
}
console.log("\n2 三段式");
{
  const c = CARDS.cards[0], s = C.cardSections(Object.assign({ symptom_text: "触地 0.14 s" }, c));
  check(s.seen === "触地 0.14 s" && s.causes.length === c.hypotheses.length && s.next.length === c.hypotheses.length, "看到了什么 / 可能原因 / 下次课练什么 三段齐全");
}
console.log("\n3 诊断进下周课表");
{
  const dr = C.drillsFromHits([{ id: "SP-01" }, "GN-01"], CARDS);
  check(dr.length === 2 && dr[0].items.length, "drillsFromHits 带出具体练习");
  check(JSON.stringify(C.focusFromHits(["SP-01"])) === JSON.stringify(["reactive", "tech"]), "focusFromHits 原返回值不变");
  const PL = mk(ath({ goalDate: plus(120) }), { drills: dr });
  const idx = PL.weeks.findIndex(w => blocks(w).some(b => /^纠正：/.test(b.t)));
  const cur = PL.weeks.findIndex(w => new Date(w.start) <= today && today - new Date(w.start) < 7 * 864e5);
  check(idx === cur + 1 && PL.weeks.filter(w => blocks(w).some(b => /^纠正：/.test(b.t))).length === 1, `纠正练习只出现在下周（第 ${idx + 1} 周）`);
}
console.log("\n4 sports.js 空项");
{
  const errs = SPORTLIB.SPORTS.flatMap(s => s.techniques.flatMap(t => t.errors || []));
  check(errs.length > 0 && !errs.some(e => ["body", "risk", "tech"].some(k => e[k] === "—")), `${errs.length} 条技术错误没有“—”`);
}
console.log("\n6 调整周真降量");
{
  check(C.DELOAD_FACTOR === 0.6, "DELOAD_FACTOR 默认 0.6");
  check(C.scaleItem("深蹲、硬拉 4×6 @ 70%–80%", 0.6) === "深蹲、硬拉 2×6 @ 70%–80%", "组数换算、强度不变");
  check(C.scaleItem("坡道冲刺 8–10×10 秒", 0.6) === "坡道冲刺 5–6×10 秒", "范围组数换算");
  for (const sport of ["volleyball", "distance", "gymnastics", "football", "longjump"].filter(id => SPORTLIB.byId(id))) {
    const PL = mk(ath({ sport, goalDate: plus(140) }));
    const dl = PL.weeks.find(w => w.deload), nm = PL.weeks.find(w => !w.deload && w.phase === dl.phase);
    check(items(dl).some(t => /×0.6.*经验值/.test(t)) && items(dl).join() !== items(nm).join(), `${SPORTLIB.byId(sport).name}：调整周课表数字已换算并注明经验值`);
  }
}
console.log("\n7 减量期");
{
  for (const wk of [12, 26, 52]) {
    const PL = mk(ath({ goalDate: plus(wk * 7 - 3) })), tp = PL.weeks.filter(w => w.phase === "taper");
    check(tp.length <= 2 && tp.length >= 1, `${PL.weeks.length} 周计划：减量期 ${tp.length} 周`);
    if (tp.length === 2) check(tp[0].volume === 0.7 && tp[1].volume === 0.5, "减量期 70% → 50%");
  }
  const PL = mk(ath({ sport: "volleyball", goalDate: plus(52 * 7 - 3) }));
  check(PL.phases.find(p => p.key === "taper").weeks === 2 && PL.notes.some(n => /封顶 2 周/.test(n)), "52 周：多出的周给赛前期，说明里写明");
}
console.log("\n8 3+1 渐进、2-for-2、触地分级");
{
  check(C.levelOf({ trainingYears: 1 }) === "初级" && C.levelOf({ level: "高级" }) === "高级", "训练水平");
  const PL = mk(ath({ sport: "volleyball", trainingYears: 3, goalDate: plus(30 * 7) }));
  const gp = PL.weeks.filter(w => w.phase === "gp").slice(0, 3).map(w => w.contacts);
  check(JSON.stringify(gp) === "[100,110,120]", `中级一般准备期 3 周触地 ${gp}`);
  check(PL.weeks.filter(w => w.phase === "gp")[3].deload, "第 4 周调整");
  check(PL.weeks.some(w => items(w).some(t => /2-for-2/.test(t))), "力量课写明 2-for-2");
}
console.log("\n9 测试进步不足保持原量");
{
  const team = [30, 34, 38, 42, 46];   // 组间 SD≈6.3 → SWC≈1.26
  const m = C.meaningfulChange({ prev: 40, curr: 40.8, team, te: 0.5, name: "反向纵跳" });
  check(m.known && !m.real, "进步 0.8 < SWC：不算有效");
  check(C.meaningfulChange({ prev: 40, curr: 42, team, te: 0.5 }).real, "进步 2 > SWC 且 > 测量误差：有效");
  check(!C.meaningfulChange({ prev: 40, curr: 42, team, te: 3 }).real, "进步 < 测量误差：不算有效");
  check(C.meaningfulChange({ prev: 4.2, curr: 4.0, team: [3.9, 4.1, 4.3, 4.5], lowerIsBetter: true }).real, "30 米跑：时间越短越好");
  check(!C.meaningfulChange({ prev: 40, curr: 45, team: [40] }).known, "没有本队数据：不判断");
  const a = ath({ sport: "volleyball", trainingYears: 3, goalDate: plus(30 * 7) });
  const PL = mk(a, { testReview: { prev: 40, curr: 40.8, team, te: 0.5, name: "反向纵跳" } }), base = mk(a);
  const h = PL.weeks.filter(w => w.hold);
  check(h.length === 3 && h.every(w => w.contacts === h[0].contacts), "下一循环 3 周触地不加");
  check(PL.notes.some(n => /最小有意义变化/.test(n)) && PL.weeks.some(w => blocks(w).some(b => b.t === "保持原量")), "计划写明原因");
  check(base.weeks.every(w => !w.hold), "没有测试结果时照常渐进");
}
console.log(fail ? `\n${fail} 项失败 ✗` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
