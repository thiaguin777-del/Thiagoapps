// Diagnóstico de interior por FAIXAS.
//
// A média do quadro inteiro mentiu a sessão inteira: um interior com
// lum 90 pode ser parede a 240 e estofado a 12. O que se quer saber num
// interior não é o brilho médio, é a RAZÃO entre a parede e o móvel —
// quando ela passa de ~4:1 sem luz prática justificando, o que falta é
// bounce, e nenhuma correção de exposição conserta isso.
//
// Para cada faixa também dispara um raycast no centro, então o número
// vem com o nome do material que o produziu.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const Q = process.env.AURA_Q || 'high';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

await page.goto(`http://127.0.0.1:8099/index.html?debug=1&q=${Q}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 });
await page.evaluate(() => window.__AURA.renderer.setPixelRatio(1));

// [x0,y0,x1,y1] normalizados 0..1 do quadro, e o ponto -1..1 do raycast.
const ZONAS = {
  'teto':        [[0.30, 0.00, 0.70, 0.10], [0.0,  0.90]],
  'pared-esq':   [[0.02, 0.20, 0.20, 0.70], [-0.80, 0.10]],
  'pared-fundo': [[0.40, 0.20, 0.60, 0.40], [0.0,  0.35]],
  'pared-dir':   [[0.80, 0.20, 0.98, 0.70], [0.80, 0.10]],
  'movel-centro':[[0.40, 0.55, 0.60, 0.75], [0.0, -0.30]],
  'piso-tapete': [[0.30, 0.85, 0.70, 0.99], [0.0, -0.88]],
};

const CENAS = JSON.parse(process.env.AURA_CENAS || '[]');

for (const [nome, pos, look, light] of CENAS) {
  const r = await page.evaluate(([p, l, lz, zonas]) => {
    if (lz) window.__AURA.setLightMode(lz, 0.001);
    window.__AURA.shot(p, l);
    const rects = {}; for (const k in zonas) rects[k] = zonas[k][0];
    const z = window.__AURA.zones(rects);
    for (const k in zonas) {
      const h = window.__AURA.matAt(zonas[k][1][0], zonas[k][1][1]);
      if (z[k]) z[k].mat = h ? h.material : '—';
    }
    return z;
  }, [pos, look, light || null, ZONAS]);

  console.log(`\n=== ${nome} (${light || 'day'}) ===`);
  const lums = [];
  for (const k in r) {
    const v = r[k];
    console.log(`  ${k.padEnd(13)} lum ${String(v.lum).padStart(5)}  min ${String(v.min).padStart(3)}  max ${String(v.max).padStart(3)}  B-R ${String(v.br).padStart(6)}   ${v.mat}`);
    lums.push(v.lum);
  }
  const hi = Math.max(...lums), lo = Math.min(...lums);
  console.log(`  RAZÃO parede/móvel: ${(hi / Math.max(lo, 0.5)).toFixed(1)}:1   (alvo < 6:1)`);
}

if (logs.length) console.log('\n--- ERROS ---\n' + logs.join('\n'));
await browser.close();
