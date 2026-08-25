// Renderiza a cena em Chromium real (WebGL2 via SwiftShader) e grava PNGs.
// É isto que permite auditar visualmente em vez de supor: o mesmo código
// que roda no celular do cliente roda aqui e vira imagem.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'shots';
const ONLY = (process.argv[3] || process.env.AURA_ONLY) ? (process.argv[3] || process.env.AURA_ONLY).split(',') : null;
mkdirSync(OUT, { recursive: true });

// Enquadramentos escolhidos para expor os problemas que importam:
// silhueta, horizonte, grama, água, interiores e escala.
// Diagnósticos extras, além das câmeras autorais do projeto.
const EXTRA = [
  ['x1-horizonte',  [46, 10, 52],   [0, 3, 0]],
  ['x2-grama',      [12, 1.3, 12],  [4, 0.4, 6]],
  ['x3-agua',       [5, 1.2, 12],   [1, 0.2, 4]],
  ['x4-arvore',     [16, 2.5, 6],   [10, 3.0, 2]],
  ['x5-aerea',      [0, 40, 34],    [0, 2, -1]],
];

const browser = await chromium.launch({
  args: [
    '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--disable-lcd-text',
  ],
});
const page = await browser.newPage({ viewport: { width: +(process.env.AURA_W || 1280), height: +(process.env.AURA_H || 720) }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

await page.goto('http://127.0.0.1:8099/index.html?debug=1&q=' + (process.env.AURA_Q || 'high') + '', { waitUntil: 'load', timeout: 120000 });

// Espera o build terminar de verdade (não um sleep arbitrário).
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 180000 })
  .catch(() => logs.push('[harness] TIMEOUT esperando __AURA.ready'));

const diag = await page.evaluate(() => {
  const A = window.__AURA;
  if (!A) return { fatal: 'módulo não expôs __AURA' };
  const gl = A.renderer.getContext();
  return {
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    quality: A.Quality.level,
    steps: A.BuildTrace.completedSteps,
    failedStep: A.BuildTrace.failedStep,
    error: A.BuildTrace.error ? String(A.BuildTrace.error) : null,
    composerFailed: A.composerFailed,
    chapters: A.CONFIG.chapters.map(c => c.title || c.id || '?'),
    objects: (() => { let n = 0; A.scene.traverse(() => n++); return n; })(),
  };
});
console.log('DIAG', JSON.stringify(diag, null, 2));

await page.evaluate(() => window.__AURA.renderer.setPixelRatio(1));

// Dispensa o overlay de entrada para que a cena apareça limpa.
await page.evaluate(() => {
  ['loader','hero','top-bar','bottom-bar','commercial','debug-panel','cta-whatsapp','present-controls','ch-overlay','nav-dots','hs-label'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.classList.remove('visible', 'show'); el.style.display = 'none'; }
  });
});

// Os marcadores de hotspot são MALHA 3D, não DOM: esconder os overlays
// não os tirava do quadro. Passei um tempo tratando "um anel laranja no
// meio do encosto do sofá" como defeito de material antes da sonda dizer
// que era um objeto de 20 cm flutuando na frente dele — o marcador
// clicável, que no produto deve mesmo aparecer. Numa imagem de avaliação
// ele só atrapalha o julgamento da cena.
// AURA_HOTSPOTS=1 mantém os marcadores, para conferir o desenho deles.
// Esconder por .visible NÃO funciona: o laço de render reescreve
// `m.visible = hsVisible` em todo quadro, então o marcador voltava.
// Tira do grafo de cena, que é o único jeito que o laço não desfaz.
if (!process.env.AURA_HOTSPOTS) {
  const n = await page.evaluate(() => {
    const alvos = [];
    window.__AURA.scene.traverse(o => {
      if (o.isMesh && o.userData && (o.userData.isRing || o.userData.id !== undefined)) alvos.push(o);
    });
    alvos.forEach(o => o.parent && o.parent.remove(o));
    return alvos.length;
  });
  console.log(`marcadores de hotspot retirados do quadro: ${n}`);
}

// A luz do capítulo faz parte do enquadramento: sem aplicá-la, um
// capítulo 'night' era renderizado com a luz de dia — foi assim que uma
// cena noturna apareceu clara e levou a um diagnóstico errado do céu.
const chapterShots = await page.evaluate(() =>
  window.__AURA.CONFIG.chapters.map((c, i) => [
    'ch' + String(i).padStart(2, '0') + '-' + (c.title || 'x').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-'),
    c.cam.pos, c.cam.look, c.light || 'day',
  ]));
const SHOTS = [...chapterShots, ...EXTRA];

for (const [name, pos, look, light] of SHOTS) {
  if (ONLY && !ONLY.some(k => name.includes(k))) continue;
  await page.evaluate(([p, l, lz]) => {
    if (lz) window.__AURA.setLightMode(lz, 0.001);
    window.__AURA.shot(p, l);
  }, [pos, look, light || null]);
  await page.waitForTimeout(400);   // deixa o heliodon assentar
  await page.waitForTimeout(700); // deixa a água/env estabilizar
  const stats = await page.evaluate(() => window.__AURA.stats());
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000, animations: 'disabled' });
  console.log(name, JSON.stringify(stats));
}

writeFileSync(`${OUT}/console.log`, logs.join('\n'));
if (logs.length) console.log('--- CONSOLE ---\n' + logs.slice(0, 40).join('\n'));
await browser.close();
