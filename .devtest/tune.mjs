// Varredura de parâmetros de luz numa única carga de página.
// Cada combinação é aplicada, renderizada e medida em milissegundos —
// é o que torna viável calibrar exposição por número em vez de por
// impressão sobre uma captura que leva dois minutos.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:8099/index.html?debug=1&q=high', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 });
await page.evaluate(() => {
  ['loader','hero','top-bar','bottom-bar','commercial','debug-panel','cta-whatsapp','present-controls','ch-overlay','nav-dots','hs-label']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  window.__AURA.renderer.setPixelRatio(1);
});

// Três enquadramentos: fachada em sombra (onde o estouro apareceu),
// panorâmica externa e um interior. Um ajuste só é bom se serve aos três.
const VIEWS = {
  sombra:  [[14.8, 3.0, -13], [9.5, 1.7, -6.5]],
  geral:   [[18, 7.5, 16], [-1, 4.2, 0]],
  interno: [[-8.6, 1.6, 3.2], [-8.8, 1.15, -2.2]],
};

const CANDIDATOS = JSON.parse(process.env.AURA_TUNE || '[{}]');

for (const cand of CANDIDATOS) {
  await page.evaluate(c => window.__AURA.tune(c), cand);
  const row = {};
  for (const [nome, [pos, look]] of Object.entries(VIEWS)) {
    row[nome] = await page.evaluate(([p, l]) => {
      window.__AURA.shot(p, l);
      return window.__AURA.metrics();
    }, [pos, look]);
  }
  const f = (m) => `lum ${String(m.lum).padStart(5)} clip ${String(m.clip).padStart(5)}% escuro ${String(m.dark).padStart(5)}% B-R ${String(m.br).padStart(5)}`;
  console.log(JSON.stringify(cand));
  for (const k of Object.keys(VIEWS)) console.log(`   ${k.padEnd(8)} ${f(row[k])}`);
}

await browser.close();
