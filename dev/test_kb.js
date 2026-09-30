// 知识库自检：结构完整、引用可追溯（正文里出现的“作者 年份”必须在已核对文献里）、技术库和实时动作都能链接到原理
const KB = require("../knowledge.js"), SPORTLIB = require("../sports.js"), COACH = require("../coach.js"), LIVE = require("../live.js");
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const REFS = { ...COACH.REFS, ...KB.EXTRA_REFS };
const ids = KB.PRINCIPLES.map(p => p.id);

check(new Set(ids).size === ids.length, `原理 ${ids.length} 条，id 不重复`);
for (const p of KB.PRINCIPLES) {
  const miss = ["rule", "why", "limits"].filter(k => !p[k] || p[k].length < 8).concat(p.name && p.name.length >= 2 ? [] : ["name"]);
  if (miss.length) check(false, `${p.name || p.id} 缺少：${miss.join("、")}`);
  if (!KB.DOMAINS.some(d => d.id === p.domain)) check(false, `${p.name} 的领域 ${p.domain} 不存在`);
  if (!(p.seen.length && p.measure.length)) check(false, `${p.name} 缺少“在哪体现”或“怎么测”`);
  for (const l of p.level) if (!KB.LEVELS[l]) check(false, `${p.name} 的证据等级 ${l} 不存在`);
  for (const r of p.refs) if (!REFS[r]) check(false, `${p.name} 引用了未核对的文献 ${r}`);
  if (p.level.includes("study") && !p.refs.length) check(false, `${p.name} 标为“研究支持”却没有文献`);
}
check(fail === 0, "每条原理都有：规律、原因、在哪体现、怎么测、适用边界、证据等级");

// 正文里的“作者 年份”必须能对上 refs 里的文献（防止写了没核对的引用）
const norm = x => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const keyOf = (name, year) => Object.keys(REFS).find(k => k.startsWith(norm(name)) && k.endsWith(year));
let citeErr = 0;
const scan = (text, refs, where) => {
  for (const m of text.matchAll(/((?:de |van )?[A-Z][A-Za-zÀ-ÿ]+) (\d{4})/g)) {
    const k = keyOf(m[1], m[2]);
    if (!k) { console.log(`  ✗ ${where}：“${m[0]}” 不在已核对文献里`); citeErr++; }
    else if (!refs.includes(k)) { console.log(`  ✗ ${where}：正文引用 ${m[0]}，但 refs 没列 ${k}`); citeErr++; }
  }
};
for (const p of KB.PRINCIPLES) scan([p.rule, p.why, p.limits].join(" "), p.refs, p.name);
for (const d of KB.DEBATES) { scan([d.pro, d.con, d.ours].join(" "), d.refs, d.q); for (const r of d.refs) if (!REFS[r]) { console.log(`  ✗ ${d.q} 引用未核对文献 ${r}`); citeErr++; } }
check(citeErr === 0, "正文里提到的每篇文献都在已核对列表中，且列进了 refs");

// 技术库 → 原理
let techN = 0, techBad = 0;
for (const s of SPORTLIB.SPORTS) for (const t of s.techniques) {
  techN++;
  if (!t.principles || !t.principles.length || t.principles.some(x => !KB.byId(x))) { techBad++; console.log(`  ✗ ${s.name}·${t.name} 原理缺失或 id 不对：${t.principles}`); }
}
check(techBad === 0, `${techN} 项技术都链接到了存在的原理`);
// 实时动作 → 原理
check(LIVE.DRILLS.every(d => d.principles.every(x => KB.byId(x))), `实时捕捉 ${LIVE.DRILLS.length} 个动作的原理都存在`);
// 生物力学原理至少被一个技术或实时动作用到（没有孤立的原理）
const used = new Set([...SPORTLIB.SPORTS.flatMap(s => s.techniques.flatMap(t => t.principles)), ...LIVE.DRILLS.flatMap(d => d.principles)]);
const orphan = KB.PRINCIPLES.filter(p => p.domain === "bio" && !used.has(p.id)).map(p => p.name);
check(!orphan.length, `生物力学原理都有对应的技术或动作${orphan.length ? "（未用：" + orphan.join("、") + "）" : ""}`);

check(KB.LOOP.length === 6 && KB.LOOP.every(s => s.q && s.steps.length && s.app), "训练闭环 6 步，每步都有问题、做法和 App 功能");
check(KB.MEASURES.rows.every(r => r.v.length === KB.MEASURES.cols.length && r.v.every(x => ["✓", "～", "✗"].includes(x))), `测量可靠性表 ${KB.MEASURES.rows.length} 行格式正确`);
check(KB.DEBATES.every(d => d.q && d.pro && d.con && d.ours), `争议 ${KB.DEBATES.length} 条，每条都有正方、反方和本系统做法`);

console.log(fail ? `\n${fail} 项失败 ✗` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
