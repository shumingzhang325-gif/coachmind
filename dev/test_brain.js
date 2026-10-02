// 大脑（鉴别诊断）自测：给定已知情境，检查推理方向是否符合教练常识、证据是否被正确加权、教练意见是否优先
const BRAIN = require("../brain.js");
const CM = require("./engine_src.js");
const { TH, CARDS } = require("./data_node.js");
const KB = require("../knowledge.js");
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const today = new Date("2026-10-01T12:00:00");
const daysAgo = n => new Date(today - n * 864e5).toISOString();
const ath = (extra = {}) => Object.assign({ name: "测试", sex: "男", weight_kg: 70, tests: [], wellness: [] }, extra);
const P = (tests = {}, radar = []) => ({ tests, targets: { squat_ratio: 2.0, slj: 3.0 }, radar });
const sprintRec = (summary, extra = {}) => Object.assign({ action: "sprint", date: daysAgo(3), fpsReal: 240, summary: Object.assign({ n_contacts: 6 }, summary) }, extra);
const run = (records, a = ath(), p = P(), opt = {}) => {
  const { observations, excluded } = BRAIN.observationsFromRecords(records, { CM, TH, CARDS, today });
  return BRAIN.reason(a, observations, p, Object.assign({ today, excluded }, opt));
};
const top = (R, fid) => R.findings.find(f => f.id === fid).causes[0].cap;

console.log("视频：触地偏长的鉴别诊断");
{
  const R = run([sprintRec({ contact_time_s: 0.15, touchdown_distance_m: 0.5 })]);
  check(top(R, "SP-01") === "tech", `触地偏长 + 着地过远 → 首要原因是技术（${top(R, "SP-01")}）`);
  const R2 = run([sprintRec({ contact_time_s: 0.15 })], ath(), P({ squat: { value: 90 } }));
  check(top(R2, "SP-01") === "strength", `触地偏长 + 深蹲只有 1.29 倍体重 → 首要原因是力量（${top(R2, "SP-01")}）`);
  const R3 = run([sprintRec({ contact_time_s: 0.15 })], ath(), P({ squat: { value: 150 } }));
  const s3 = R3.findings[0].causes.find(c => c.cap === "strength").p, s2 = R2.findings[0].causes.find(c => c.cap === "strength").p;
  check(s3 < s2 / 2, `深蹲已达标（2.14 倍）时“力量不足”的比例明显下降（${Math.round(s2 * 100)}% → ${Math.round(s3 * 100)}%）`);
  const R4 = run([sprintRec({ contact_time_s: 0.15 })]);
  check(R4.undecided.length && /深蹲|RSI/.test(R4.undecided[0]), `没有测试数据时说“还不能确定”，并建议做区分测试：${R4.undecided[0]}`);
}

console.log("\n测量可靠性与教练意见");
{
  const R = run([sprintRec({ contact_time_s: 0.125 })]);            // 0.125 在 0.12 ± 0.010 内：边缘
  const f = R.findings.find(x => x.id === "SP-01");
  check(f && f.conf <= 0.31, `边缘结果只给低权重（${f && f.conf.toFixed(2)}）`);
  const R30 = run([sprintRec({ contact_time_s: 0.135 }, { fpsReal: 30 })]);
  const f30 = R30.findings.find(x => x.id === "SP-01");
  check(f30 && f30.conf <= 0.31, `30 fps 视频的触地偏长只算边缘（${f30 && f30.conf.toFixed(2)}）`);
  const Rd = run([sprintRec({ contact_time_s: 0.15 }, { verdicts: { "SP-01": "disagree" } })]);
  check(!Rd.findings.some(x => x.id === "SP-01") && Rd.excluded.length === 1, `教练“不认同”的结论被排除，并记录原因`);
  const old = run([sprintRec({ contact_time_s: 0.15 }, { date: daysAgo(90) })]), fresh = run([sprintRec({ contact_time_s: 0.15 })]);
  check(old.findings[0].conf < fresh.findings[0].conf * 0.25, `90 天前的视频权重低（${old.findings[0].conf.toFixed(2)} vs ${fresh.findings[0].conf.toFixed(2)}）`);
  const once = run([sprintRec({ contact_time_s: 0.15 })]), twice = run([sprintRec({ contact_time_s: 0.15 }), sprintRec({ contact_time_s: 0.15 }, { date: daysAgo(10) })]);
  check(twice.findings[0].conf > once.findings[0].conf, `同一问题出现两次，可信度上升（${once.findings[0].conf.toFixed(2)} → ${twice.findings[0].conf.toFixed(2)}）`);
}

console.log("\n实时捕捉：深蹲问题");
{
  const live = (faults, n = 8, extra = {}) => Object.assign({ action: "live", drill: "squat", date: daysAgo(2), summary: { n, viewOkRate: 1 }, faults }, extra);
  const R = run([live([{ key: "shallow", n: 6 }, { key: "heel", n: 5 }])]);
  check(R.priorities[0].key === "mobility", `蹲不深 + 脚跟离地 → 首要能力是灵活性（${R.priorities[0].name}）`);
  const Rok = run([live([{ key: "shallow", n: 6 }, { key: "heel", n: 5 }])], ath(), P({ ankle: { value: 14 } }));
  const mob = x => (x.priorities.find(p => p.key === "mobility") || { score: 0 }).score;
  check(mob(Rok) < mob(R) * 0.7, `踝背屈测试正常（14 cm）时灵活性分数下降（${mob(R)} → ${mob(Rok)}）`);
  const noise = run([live([{ key: "shallow", n: 1 }], 10)]);
  check(!noise.findings.length, `10 次里只出现 1 次的问题当作噪声忽略`);
  const badView = run([live([{ key: "shallow", n: 6 }], 8, { summary: { n: 8, viewOkRate: 0.4 } })]);
  check(badView.findings[0].conf < R.findings.find(f => f.id === "squat.shallow").conf, `拍摄角度不合格时降权`);
  const valg = run([Object.assign(live([{ key: "valgus", n: 5 }]), { drill: "squatFront" })]);
  check(valg.cautions.some(c => c.level === "safety" && /膝/.test(c.text)), `膝内扣给出安全提醒`);
}

console.log("\n多来源印证");
{
  const live = { action: "live", drill: "squat", date: daysAgo(2), summary: { n: 8, viewOkRate: 1 }, faults: [{ key: "hipfirst", n: 6 }] };
  const only = run([live]);
  const both = run([live], ath(), P({ squat: { value: 90 } }, [{ key: "strength", name: "力量", score: 64, cur: "1.29 倍体重", tgt: "2.0 倍体重" }]));
  const st = R => R.priorities.find(p => p.key === "strength");
  check(st(only) && st(only).confidence !== "高", `只有实时捕捉一个来源：可信度不是“高”（${st(only) && st(only).confidence}）`);
  check(st(both) && st(both).confidence === "高" && st(both).sources.length >= 2, `实时捕捉 + 体能测试都指向力量：可信度“高”`);
  check(st(both).why.length >= 2, `推理链写明两条依据`);
}

console.log("\n来源独立性（端到端测试中发现：同一段视频被算成两个来源）");
{
  // 雷达“技术”分由同一段视频的触地时间算出：不能和视频诊断算作两个独立来源
  const R = run([sprintRec({ contact_time_s: 0.15, touchdown_distance_m: 0.5 })], ath(), P({}, [{ key: "tech", name: "技术", score: 67, cur: "触地 0.150 s", tgt: "≤ 0.1 s" }]));
  const t = R.priorities.find(p => p.key === "tech");
  check(t && t.confidence !== "高" && t.sources.join() === "video", `只有视频一个来源时，“技术”可信度不是高（${t && t.confidence}，来源 ${t && t.sources.join("、")}）`);
  const W = [0, 1, 2, 3].map(i => ({ date: daysAgo(i).slice(0, 10), sleep: 5.5, fatigue: 4, soreness: 3 }));
  const R2 = run([], ath({ wellness: W }), P({}, [{ key: "recovery", name: "恢复", score: 50, cur: "睡眠 5.5 小时", tgt: "8 小时" }]));
  const rc = R2.priorities.find(p => p.key === "recovery");
  check(rc && rc.sources.join() === "wellness" && rc.confidence !== "高", `雷达“恢复”分和每日打卡是同一份数据：只算一个来源`);
}

{
  // 技术是动作专项的：短跑视频 + 深蹲实时捕捉不能算互相印证；力量是通用能力，可以
  const live = { action: "live", drill: "squat", date: daysAgo(2), summary: { n: 8, viewOkRate: 1 }, faults: [{ key: "shallow", n: 6 }, { key: "hipfirst", n: 6 }] };
  const R = run([sprintRec({ contact_time_s: 0.15, touchdown_distance_m: 0.5 }), live]);
  const t = R.priorities.find(p => p.key === "tech"), st = R.priorities.find(p => p.key === "strength");
  check(t && t.confidence !== "高", `短跑视频 + 深蹲实时捕捉：“技术”不算互相印证（${t && t.confidence}）`);
  check(st && st.confidence === "高", `同样两条记录：“最大力量”是通用能力，算互相印证（${st && st.confidence}）`);
}

console.log("\n规则完整性");
{
  const caps = Object.keys(BRAIN.CAPS);
  let bad = 0;
  for (const [id, R] of Object.entries(BRAIN.RULES)) {
    if (!R.causes.every(c => caps.includes(c.cap))) { bad++; console.log("  ✗ 未知能力", id); }
    if (!(R.principles || []).every(p => KB.byId(p))) { bad++; console.log("  ✗ 原理不存在", id); }
    const s = R.causes.reduce((t, c) => t + c.w, 0); if (Math.abs(s - 1) > 0.01) { bad++; console.log("  ✗ 先验和不为 1", id, s); }
  }
  for (const [k, C] of Object.entries(BRAIN.CAPS)) if (!C.principles.every(p => KB.byId(p)) || !C.retest || !C.addon) { bad++; console.log("  ✗ 能力信息不全", k); }
  check(bad === 0, `${Object.keys(BRAIN.RULES).length} 条诊断规则、${caps.length} 种能力：原因、原理、复测方法齐全`);
  const cardIds = CARDS.cards.map(c => c.id);
  check(cardIds.every(id => BRAIN.RULES[id]), `每张视频诊断卡都有对应的鉴别规则`);
  const LIVE = require("../live.js");
  const liveFaults = LIVE.DRILLS.flatMap(d => Object.keys(d.cues).map(k => `${d.id}.${k}`));
  const miss = liveFaults.filter(id => !BRAIN.RULES[id]);
  check(!miss.length, `每个实时捕捉错误都有对应的鉴别规则${miss.length ? "（缺：" + miss.join("、") + "）" : ""}`);
}

console.log(fail ? `\n${fail} 项失败 ✗` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
