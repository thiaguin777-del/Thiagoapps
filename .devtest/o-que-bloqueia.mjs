// O que bloqueia o sol da golden hour?
//
// Medido: o sol contribui +18,0 no piso da sala em t=0,30, e volta a ZERO
// em t=0,45 e t=0,60 — justamente a golden hour, que é quando um sol
// rasante deveria varrer o piso inteiro. A conta geométrica do beiral não
// explica: a 13° de elevação a sombra da laje cairia atrás da parede de
// fundo, ou seja, o piso deveria estar no sol.
//
// Em vez de continuar deduzindo, dispara um raio de cada ponto do piso na
// direção do sol e diz o nome do primeiro objeto atingido. Se não houver
// nada no caminho, o problema é de sombra/shadow map, não de geometria.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://127.0.0.1:8099/index.html?debug=1&q=high', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 });

const PONTOS = [
  [-8.6, 0.20, 4.0], [-8.6, 0.20, 1.0], [-8.6, 0.20, -2.0],
  [-4.0, 0.20, 3.0], [0.0, 0.20, 3.0],
  [8.0, 0.20, 3.0], [8.0, 0.20, -2.0],
];

for (const t of [0.30, 0.45, 0.52, 0.60]) {
  const r = await page.evaluate(([t, pts]) => {
    const A = window.__AURA, T = A.THREE;
    A.applySolarTime(t);
    const sol = A.scene.children.find(o => o.isDirectionalLight);
    const dir = sol.position.clone().normalize();
    const out = { sol: [+sol.position.x.toFixed(1), +sol.position.y.toFixed(1), +sol.position.z.toFixed(1)],
                  elev: +(Math.asin(dir.y) * 180 / Math.PI).toFixed(1),
                  intens: +sol.intensity.toFixed(2), hits: [] };
    for (const p of pts) {
      const rc = new T.Raycaster(new T.Vector3(p[0], p[1], p[2]), dir, 0.05, 300);
      const hits = rc.intersectObject(A.scene, true)
        .filter(h => h.object.isMesh && h.object.visible && h.object.castShadow);
      const h = hits[0];
      let nome = '(céu livre)';
      if (h) {
        // sobe a hierarquia até achar um nó com nome
        let n = h.object, path = [];
        while (n && path.length < 4) { if (n.name) path.push(n.name); n = n.parent; }
        const mats = Array.isArray(h.object.material) ? h.object.material : [h.object.material];
        let mn = '?';
        for (const k in A.M) if (mats.indexOf(A.M[k]) >= 0) mn = k;
        nome = `${mn} a ${h.distance.toFixed(1)}m  y=${h.point.y.toFixed(2)} z=${h.point.z.toFixed(1)}` +
               (path.length ? ' [' + path.join('<') + ']' : '');
      }
      out.hits.push(`(${p[0]},${p[2]}) -> ${nome}`);
    }
    return out;
  }, [t, PONTOS]);

  console.log(`\n=== t=${t}  elevação ${r.elev}°  intensidade ${r.intens}  sol ${JSON.stringify(r.sol)} ===`);
  r.hits.forEach(h => console.log('   ' + h));
}
await browser.close();
