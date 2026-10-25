// 心率负荷自测：区间时间、TRIMP、三种手表导出格式、各种“不可信”情况的提示
const H = require("../hrload.js");
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const today = new Date("2026-10-01T10:00:00");
// 已知真值：最大心率 200；10 分钟 110（55%，1 区）+ 20 分钟 150（75%，3 区）+ 10 分钟 170（85%，4 区），每 5 秒一个点
const segs = [[10, 110], [20, 150], [10, 170]], samples = [];
let t = 0; for (const [m, hr] of segs) for (let k = 0; k < m * 12; k++) { samples.push([t, hr]); t += 5; }
samples.push([t, 170]);
const a = { hrMax: 200 };

{
  const Z = H.zoneMinutes(samples, 200);
  check(Math.abs(Z.mins[0] - 10) < 0.1 && Math.abs(Z.mins[2] - 20) < 0.1 && Math.abs(Z.mins[3] - 10) < 0.1, `区间时间 1 区 ${Z.mins[0].toFixed(1)}、3 区 ${Z.mins[2].toFixed(1)}、4 区 ${Z.mins[3].toFixed(1)} 分钟（真值 10 / 20 / 10）`);
  check(Math.round(H.edwardsTrimp(Z.mins)) === 110, `心率负荷 TRIMP = ${Math.round(H.edwardsTrimp(Z.mins))}（真值 10×1 + 20×3 + 10×4 = 110）`);
  const gap = samples.slice(0, 120).concat(samples.slice(120).map(([s, h]) => [s + 600, h]));
  const Zg = H.zoneMinutes(gap, 200);
  check(Math.abs(Zg.coveredMin - 40) < 0.2, `中途暂停 10 分钟不计入（有效 ${Zg.coveredMin.toFixed(1)} 分钟）`);
}
{
  const iso = s => new Date(Date.parse("2026-09-30T07:00:00Z") + s * 1000).toISOString();
  const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity><Lap><Track>${samples.map(([s, h]) => `<Trackpoint><Time>${iso(s)}</Time><HeartRateBpm><Value>${h}</Value></HeartRateBpm></Trackpoint>`).join("")}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  const gpx = `<gpx version="1.1"><trk><trkseg>${samples.map(([s, h]) => `<trkpt lat="0" lon="0"><time>${iso(s)}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${h}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`).join("")}</trkseg></trk></gpx>`;
  const csv = "time,heart_rate\n" + samples.map(([s, h]) => `${iso(s)},${h}`).join("\n");
  for (const [name, text] of [["run.tcx", tcx], ["run.gpx", gpx], ["run.csv", csv]]) {
    const w = H.parseWorkout(name, text);
    const L = w && H.sessionLoad({ samples: w.samples, minutes: w.minutes }, a, today);
    check(w && w.minutes === 40 && L.trimp === 110, `${name}：读出 ${w && w.minutes} 分钟、TRIMP ${L && L.trimp}`);
  }
}
{
  const est = H.sessionLoad({ samples, minutes: 40 }, { birthYear: 2006 }, today);
  check(est.notes.some(n => /估算/.test(n)), `没有实测最大心率：用年龄估算并提示`);
  const st = H.sessionLoad({ samples, minutes: 40, rpe: 7, type: "最大力量" }, a, today);
  check(st.notes.some(n => /心率跟不上/.test(n)), `力量课：提示心率负荷会低估，以 RPE × 时长为准`);
  const tired = H.sessionLoad({ samples, minutes: 40, rpe: 19, type: "低强度有氧" }, a, today);
  check(tired.notes.some(n => /主观感觉很累/.test(n)), `主观很累、心率负荷不高：提示疲劳或不适`);
  const hot = H.sessionLoad({ samples, minutes: 40, rpe: 3, type: "低强度有氧" }, a, today);
  check(hot.notes.some(n => /主观感觉轻松/.test(n)), `心率负荷高、主观轻松：提示天热、脱水或刚生病`);
  const hi = H.sessionLoad({ samples: samples.map(([s, h]) => [s, h + 40]), minutes: 40 }, a, today);
  check(hi.notes.some(n => /超过设定的最大心率/.test(n)), `实测心率超过设定最大心率：提示更新`);
  const avgOnly = H.sessionLoad({ hrAvg: 150, minutes: 40 }, a, today);
  check(avgOnly.trimp === 120 && avgOnly.notes.some(n => /粗略/.test(n)), `只有平均心率：粗略估算并说明（${avgOnly.trimp}）`);
}
console.log(fail ? `\n${fail} 项失败 ✗` : "\n全部通过 ✓");
process.exit(fail ? 1 : 0);
