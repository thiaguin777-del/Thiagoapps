// O sol entra na casa?
//
// No teste de atribuição, desligar a DirectionalLight mudou o interior em
// ZERO em ambos os cômodos. Numa casa com fachada sul inteira em vidro
// isso ou é o horário, ou é a luz do sol nunca alcançar o piso interno —
// e mancha de sol no chão é dos sinais mais fortes de que um interior é
// real. Vale saber qual dos dois.
//
// Mede o piso interno com sol ligado e desligado ao longo do dia.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:8099/index.html?debug=1&q=high', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 });
await page.evaluate(() => window.__AURA.renderer.setPixelRatio(1));

// enquadramento de piso interno, olhando para baixo a partir do vidro sul
const CAMS = {
  'piso sala':  [[-8.6, 2.2, 4.6], [-8.6, 0.15, -1.0]],
  'piso suite': [[6.6, 2.2, 4.6], [6.6, 0.15, -1.0]],
};
const ZON = { piso: [0.20, 0.45, 0.80, 0.98] };

console.log('  hora        cena      com sol   sem sol    Δ do sol');
for (const nome in CAMS) {
  for (const t of [0, 0.15, 0.3, 0.45, 0.6]) {
    const r = await page.evaluate(([cam, zon, t]) => {
      const A = window.__AURA;
      A.applySolarTime(t);
      A.shot(cam[0], cam[1]);
      const com = A.zones(zon).piso;
      const guarda = [];
      A.scene.traverse(o => {
        if (o.isDirectionalLight) { guarda.push([o, o.intensity]); o.intensity = 0; }
      });
      const sem = A.zones(zon).piso;
      guarda.forEach(([o, v]) => o.intensity = v);
      const sol = A.scene.children.find(o => o.isDirectionalLight);
      return {
        com: com.lum, comMax: com.max, sem: sem.lum,
        solPos: sol ? [+sol.position.x.toFixed(1), +sol.position.y.toFixed(1), +sol.position.z.toFixed(1)] : null,
      };
    }, [CAMS[nome], ZON, t]);
    console.log(
      `  t=${t.toFixed(2)}  ${nome.padEnd(11)} ${String(r.com).padStart(6)} (max ${String(r.comMax).padStart(3)}) ` +
      `${String(r.sem).padStart(7)}  ${(r.com - r.sem >= 0 ? '+' : '') + (r.com - r.sem).toFixed(1)}   sol ${JSON.stringify(r.solPos)}`);
  }
}
await browser.close();
