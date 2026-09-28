// 检查 .task（ZIP）结构是否完整：末尾目录记录、中央目录、里面有没有 .tflite
function zipCheck(buf) {
  const u = new Uint8Array(buf), n = u.length, dv = new DataView(buf);
  if (n < 22) return { ok: false, reason: "文件太小" };
  if (!(u[0] === 0x50 && u[1] === 0x4B && u[2] === 0x03 && u[3] === 0x04)) return { ok: false, reason: "开头不是 ZIP 文件头" };
  let e = -1;
  for (let i = n - 22; i >= Math.max(0, n - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) return { ok: false, reason: "找不到 ZIP 结尾目录，文件被截断或损坏" };
  const count = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
  if (cdOff + cdSize > e) return { ok: false, reason: "ZIP 目录位置对不上，文件内容被改动过（常见于换行符转换）" };
  const names = [];
  let p = cdOff;
  for (let k = 0; k < count; k++) {
    if (p + 46 > n || dv.getUint32(p, true) !== 0x02014b50) return { ok: false, reason: "ZIP 目录记录损坏" };
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    if (lho + 4 > n || dv.getUint32(lho, true) !== 0x04034b50) return { ok: false, reason: "ZIP 内文件位置错乱，文件内容被改动过" };
    names.push(new TextDecoder().decode(u.slice(p + 46, p + 46 + nl)));
    p += 46 + nl + xl + cl;
  }
  if (!names.some(s => s.endsWith(".tflite"))) return { ok: false, reason: "ZIP 里没有模型（.tflite）" };
  return { ok: true, names };
}
module.exports = zipCheck;
