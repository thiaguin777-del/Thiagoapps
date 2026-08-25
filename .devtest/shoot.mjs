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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

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

const chapterShots = await page.evaluate(() =>
  window.__AURA.CONFIG.chapters.map((c, i) => [
    'ch' + String(i).padStart(2, '0') + '-' + (c.title || 'x').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-'),
    c.cam.pos, c.cam.look,
  ]));
const SHOTS = [...chapterShots, ...EXTRA];

for (const [name, pos, look] of SHOTS) {
  if (ONLY && !ONLY.some(k => name.includes(k))) continue;
  await page.evaluate(([p, l]) => window.__AURA.shot(p, l), [pos, look]);
  await page.waitForTimeout(700); // deixa a água/env estabilizar
  const stats = await page.evaluate(() => window.__AURA.stats());
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000, animations: 'disabled' });
  console.log(name, JSON.stringify(stats));
}

writeFileSync(`${OUT}/console.log`, logs.join('\n'));
if (logs.length) console.log('--- CONSOLE ---\n' + logs.slice(0, 40).join('\n'));
await browser.close();
