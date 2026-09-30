// 检查 .task（ZIP）结构是否完整。直接按字节读取，不用 DataView（Safari 对下载得到的数据会报错）
function zipCheck(buf) {
  let u;
  try { u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); } catch (e) { return { ok: false, reason: "无法读取文件内容" }; }
  const n = u.length;
  const u16 = i => u[i] | (u[i + 1] << 8);
  const u32 = i => (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16) | (u[i + 3] << 24)) >>> 0;
  if (n < 22) return { ok: false, reason: "文件太小" };
  if (u32(0) !== 0x04034b50) return { ok: false, reason: "开头不是 ZIP 文件头" };
  let e = -1;
  for (let i = n - 22; i >= Math.max(0, n - 65557); i--) if (u[i] === 0x50 && u32(i) === 0x06054b50) { e = i; break; }
  if (e < 0) return { ok: false, reason: "找不到 ZIP 结尾目录，文件被截断或损坏" };
  const count = u16(e + 10), cdSize = u32(e + 12), cdOff = u32(e + 16);
  if (cdOff + cdSize > e) return { ok: false, reason: "ZIP 目录位置对不上，文件内容被改动过（常见于换行符转换）" };
  const names = [];
  let p = cdOff;
  for (let k = 0; k < count; k++) {
    if (p + 46 > n || u32(p) !== 0x02014b50) return { ok: false, reason: "ZIP 目录记录损坏" };
    const nl = u16(p + 28), xl = u16(p + 30), cl = u16(p + 32), lho = u32(p + 42);
    if (lho + 4 > n || u32(lho) !== 0x04034b50) return { ok: false, reason: "ZIP 内文件位置错乱，文件内容被改动过" };
    let name = ""; for (let j = 0; j < nl; j++) name += String.fromCharCode(u[p + 46 + j]);
    names.push(name);
    p += 46 + nl + xl + cl;
  }
  if (!names.some(s => s.endsWith(".tflite"))) return { ok: false, reason: "ZIP 里没有模型（.tflite）" };
  return { ok: true, names };
}
module.exports = zipCheck;
