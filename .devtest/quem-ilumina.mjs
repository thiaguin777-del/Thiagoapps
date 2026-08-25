// Quem está iluminando o quê.
//
// A varredura mostrou que baixar envMapIntensity do estuque de 1.0 para
// 0.35 não moveu a parede um único nível (185.1 -> 185.1). Ou seja: a
// hipótese de "IBL do céu estourando a parede" está errada, e continuar
// ajustando envMapIntensity seria ajustar um botão desligado.
//
// Este teste desliga UMA fonte por vez e mede a queda em cada faixa. A
// fonte responsável é aquela cujo desligamento derruba a parede.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:8099/index.html?debug=1&q=high', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 });
await page.evaluate(() => window.__AURA.renderer.setPixelRatio(1));

const ZON = {
  teto:   [0.30, 0.00, 0.70, 0.10],
  parede: [0.80, 0.20, 0.98, 0.70],
  movel:  [0.40, 0.55, 0.60, 0.75],
  piso:   [0.30, 0.85, 0.70, 0.99],
};
const CAMS = {
  sala:  [[-8.6, 1.6, 3.2], [-8.8, 1.15, -2.2]],
  suite: [[6.6, 1.6, 3.4], [6.6, 1.05, -1.4]],
};

const FONTES = ['nenhuma', 'sol', 'hemi', 'ambient', 'rect', 'env', 'emissivos', 'wash'];

for (const nomeCam in CAMS) {
  console.log(`\n############ ${nomeCam} ############`);
  console.log('  desligando  |  teto parede  movel   piso');
  let base = null;
  for (const f of FONTES) {
    const r = await page.evaluate(([cam, zon, f]) => {
      const A = window.__AURA, T = A.THREE;
      A.applySolarTime(0);                       // restaura tudo
      const guarda = [];
      A.scene.traverse(o => {
        if (o.isDirectionalLight && f === 'sol') { guarda.push([o, o.intensity]); o.intensity = 0; }
        if (o.isHemisphereLight && f === 'hemi') { guarda.push([o, o.intensity]); o.intensity = 0; }
        if (o.isAmbientLight && f === 'ambient') { guarda.push([o, o.intensity]); o.intensity = 0; }
        if (o.isRectAreaLight && f === 'rect') { guarda.push([o, o.intensity]); o.intensity = 0; }
      });
      let envAntes = null;
      if (f === 'env') { envAntes = A.scene.environment; A.scene.environment = null; }
      const emis = [];
      if (f === 'emissivos') {
        A.scene.traverse(o => {
          const ms = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          ms.forEach(m => { if (m && m.emissiveIntensity > 0) { emis.push([m, m.emissiveIntensity]); m.emissiveIntensity = 0; } });
        });
      }
      let washAntes = null;
      if (f === 'wash') { washAntes = A.wash.value; A.wash.value = 0; }

      A.shot(cam[0], cam[1]);
      const z = A.zones(zon);

      guarda.forEach(([o, v]) => o.intensity = v);
      if (envAntes !== null) A.scene.environment = envAntes;
      emis.forEach(([m, v]) => m.emissiveIntensity = v);
      if (washAntes !== null) A.wash.value = washAntes;
      return z;
    }, [CAMS[nomeCam], ZON, f]);

    const linha = ['teto', 'parede', 'movel', 'piso']
      .map(k => String(r[k].lum).padStart(6)).join(' ');
    if (f === 'nenhuma') { base = r; console.log(`  ${'(base)'.padEnd(11)} | ${linha}`); }
    else {
      const delta = ['teto', 'parede', 'movel', 'piso']
        .map(k => { const d = r[k].lum - base[k].lum; return (d >= 0 ? '+' : '') + d.toFixed(0); })
        .map(s => s.padStart(6)).join(' ');
      console.log(`  ${f.padEnd(11)} | ${linha}   Δ ${delta}`);
    }
  }
}
await browser.close();
