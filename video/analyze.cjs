// Kuru koşu günlüğü özeti: işaretler, hasar / near-miss anları ve çevresindeki trafik
const d = JSON.parse(require('fs').readFileSync(process.argv[2]));
const L = d.log.filter((e) => !e.mark);
for (const m of d.meta.marks) console.log('MARK', m.mark, m.i, (m.i / 60).toFixed(2));
for (let k = 1; k < L.length; k++) {
  const p = L[k - 1], e = L[k];
  if (e.hp !== p.hp || e.nm !== p.nm) {
    console.log(`${e.i} ${(e.i / 60).toFixed(2)} ${e.st} hp ${p.hp}->${e.hp} nm ${e.nm} x=${e.x} tx=${e.tx} v=${e.v}`);
    if (e.hp !== p.hp) for (let j = Math.max(0, k - 40); j <= k; j += 8) console.log('   ', L[j].i, 'x', L[j].x, 'tx', L[j].tx, JSON.stringify(L[j].near));
  }
}
