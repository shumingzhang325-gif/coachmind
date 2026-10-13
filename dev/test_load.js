// 负荷比值（急性:慢性）：每天负荷不变时应约等于 1，不论历史是 22 天还是 40 天（旧算法 22 天时虚高约 1/3）
const C = require("../coach.js");
let ok = true; const chk = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) ok = false; };
const mk = days => ({ wellness: [...Array(days)].map((_, k) => ({ date: new Date(Date.now() - k * 864e5 - 36e5).toISOString().slice(0, 10), rpe: 5, minutes: 60 })) });
for (const days of [22, 25, 28, 40]) {
  const r = C.loadRatio(mk(days));
  chk(r != null && Math.abs(r - 1) < 0.15, `每天负荷相同、${days} 天记录：负荷比值 ${r && r.toFixed(2)}（应约 1.00）`);
}
chk(C.loadRatio(mk(14)) === null, "不足 3 周记录不计算");
console.log(ok ? "\n全部通过 ✓" : "\n有失败 ✗"); process.exit(ok ? 0 : 1);
