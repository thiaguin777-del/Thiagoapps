// Sonda de defeito pontual: aponta para um pixel e responde o que está
// ali, a que distância, e que luzes pontuais existem em volta.
//
// Dois defeitos a explicar:
//  - anel laranja no meio do encosto do sofá (cap. 4) e da cabeceira
//    (cap. 6). Os dois são M.tecidoSofa, que NÃO tem mapa de cor — só um
//    normal map de ruído. Logo não é textura: ou é luz, ou é geometria.
//  - a barra branca atrás da cabeceira: o cove deveria estar embutido
//    atrás de uma testeira depois da correção, e voltou mais grosso.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:8099/index.html?debug=1&q=high', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 });

const CENAS = [
  ['sala', [-8.6, 1.6, 3.2], [-8.8, 1.15, -2.2], {
    'anel no encosto':   [0.052, -0.148],
    'encosto ao lado':   [-0.22, -0.148],
    'mancha no teto':    [-0.375, 0.889],
  }],
  ['suíte', [6.6, 1.6, 3.4], [6.6, 1.05, -1.4], {
    'barra branca':      [-0.042, 0.333],
    'anel na cabeceira': [0.042, 0.030],
    'cabeceira ao lado': [-0.25, 0.030],
  }],
];

for (const [nome, cam, look, pontos] of CENAS) {
  console.log(`\n############ ${nome} ############`);
  const r = await page.evaluate(([cam, look, pontos]) => {
    const A = window.__AURA, T = A.THREE;
    A.applySolarTime(0);
    A.shot(cam, look);
    const out = {};
    for (const k in pontos) {
      const rc = new T.Raycaster();
      rc.setFromCamera(new T.Vector2(pontos[k][0], pontos[k][1]), A.camera);
      const h = rc.intersectObject(A.scene, true).filter(x => x.object.isMesh && x.object.visible)[0];
      if (!h) { out[k] = { erro: 'nada' }; continue; }
      const p = h.point;
      const mats = Array.isArray(h.object.material) ? h.object.material : [h.object.material];
      let mn = '?';
      for (const key in A.M) if (mats.indexOf(A.M[key]) >= 0) mn = key;
      const luzes = [];
      A.scene.traverse(o => {
        if (!o.isLight || o.isAmbientLight || o.isHemisphereLight || o.isDirectionalLight) return;
        const wp = new T.Vector3(); o.getWorldPosition(wp);
        const d = wp.distanceTo(p);
        if (d < 4.0) luzes.push(`${o.type}@${d.toFixed(2)}m i=${o.intensity.toFixed(2)} pos=${[wp.x, wp.y, wp.z].map(v => v.toFixed(2)).join(',')}`);
      });
      // dimensões do objeto atingido, para saber se é fita, testeira ou parede
      const bb = new T.Box3().setFromObject(h.object);
      const sz = bb.getSize(new T.Vector3());
      out[k] = {
        material: mn,
        ponto: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
        distCam: +h.distance.toFixed(2),
        emissivo: mats[0] && mats[0].emissive ? '#' + mats[0].emissive.getHexString() + '@' + (mats[0].emissiveIntensity || 0) : null,
        cor: mats[0] && mats[0].color ? '#' + mats[0].color.getHexString() : null,
        objTam: [+sz.x.toFixed(2), +sz.y.toFixed(2), +sz.z.toFixed(2)],
        fundido: !!h.object.userData.merged,
        luzes: luzes.slice(0, 4),
      };
    }
    return out;
  }, [cam, look, pontos]);

  for (const k in r) {
    const v = r[k];
    if (v.erro) { console.log(`  ${k.padEnd(20)} ${v.erro}`); continue; }
    console.log(`  ${k}`);
    console.log(`     material ${v.material}  cor ${v.cor}  emissivo ${v.emissivo}`);
    console.log(`     ponto ${JSON.stringify(v.ponto)}  a ${v.distCam}m da câmera  fundido ${v.fundido}`);
    console.log(`     tamanho do objeto ${JSON.stringify(v.objTam)}`);
    v.luzes.forEach(l => console.log(`     luz: ${l}`));
    if (!v.luzes.length) console.log('     nenhuma luz pontual em 4 m');
  }
}
await browser.close();
