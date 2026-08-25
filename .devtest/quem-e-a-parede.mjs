// Contradição a resolver: desligar scene.environment derruba a parede em
// -142, mas mexer em M.estuque.envMapIntensity não move nada. As duas
// coisas só são verdade ao mesmo tempo se o material da parede NÃO for o
// objeto M.estuque — é uma cópia.
//
// Este teste pega o material pelo raycast (a instância real na tela) e
// mexe NELA, comparando com a identidade de M.estuque.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:8099/index.html?debug=1&q=high', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 });
await page.evaluate(() => window.__AURA.renderer.setPixelRatio(1));

const r = await page.evaluate(() => {
  const A = window.__AURA, T = A.THREE;
  A.shot([-8.6, 1.6, 3.2], [-8.8, 1.15, -2.2]);
  const ZON = { parede: [0.80, 0.20, 0.98, 0.70] };

  // material real sob o ponto da parede
  const rc = new T.Raycaster();
  rc.setFromCamera(new T.Vector2(0.80, 0.10), A.camera);
  const hits = rc.intersectObject(A.scene, true).filter(h => h.object.isMesh);
  const h0 = hits[0];
  const o = h0.object;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const grp = (o.geometry.groups || []).find(g =>
    h0.faceIndex * 3 >= g.start && h0.faceIndex * 3 < g.start + g.count);
  const mat = grp ? mats[grp.materialIndex] : mats[0];

  const out = {
    mesh: o.name || '(sem nome)',
    fundido: !!o.userData.merged,
    nMateriais: mats.length,
    ehMEstuque: mat === A.M.estuque,
    uuidNaTela: mat.uuid,
    uuidMEstuque: A.M.estuque ? A.M.estuque.uuid : null,
    envINaTela: mat.envMapIntensity,
    envIEmM: A.M.estuque ? A.M.estuque.envMapIntensity : null,
    corNaTela: '#' + mat.color.getHexString(),
    roughNaTela: mat.roughness,
  };

  // Quantas cópias de cada material existem na cena?
  const porNome = {};
  A.scene.traverse(x => {
    if (!x.isMesh) return;
    (Array.isArray(x.material) ? x.material : [x.material]).forEach(m => {
      if (!m) return;
      const nm = m.name || '(anon)';
      porNome[nm] = porNome[nm] || new Set();
      porNome[nm].add(m.uuid);
    });
  });
  out.copias = Object.entries(porNome)
    .filter(([, s]) => s.size > 1)
    .map(([n, s]) => n + '=' + s.size).slice(0, 20);

  // Prova: mexe na INSTÂNCIA da tela e mede.
  const antes = A.zones(ZON).parede.lum;
  const guardado = mat.envMapIntensity;
  mat.envMapIntensity = 0.05;
  const depois = A.zones(ZON).parede.lum;
  mat.envMapIntensity = guardado;
  out.paredeAntes = antes;
  out.paredeComEnv005 = depois;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
