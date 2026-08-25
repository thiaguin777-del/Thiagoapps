// Sonda de diagnóstico: constrói a cena e reporta números, sem gravar
// imagem. Screenshot em SwiftShader custa ~1 min cada; isto roda em
// segundos e é o que se usa para validar fusão, contagem de objetos e
// erros de console a cada alteração.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const Q = process.env.AURA_Q || 'high';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

await page.goto(`http://127.0.0.1:8099/index.html?debug=1&q=${Q}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 })
  .catch(() => logs.push('[sonda] TIMEOUT em __AURA.ready'));

const out = await page.evaluate(() => {
  const A = window.__AURA;
  if (!A) return { fatal: 'sem __AURA' };
  let meshes = 0, instanced = 0, merged = 0, insts = 0, tris = 0;
  A.scene.traverse(o => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) { instanced++; insts += o.count; }
    else meshes++;
    if (o.userData.merged) merged++;
    const g = o.geometry;
    if (g && g.index) tris += (g.index.count / 3) * (o.isInstancedMesh ? o.count : 1);
    else if (g && g.attributes.position) tris += (g.attributes.position.count / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  // enquadramento panorâmico: mede a cena inteira, não um canto dela
  A.shot([18, 7.5, 16], [-1, 4.2, 0]);
  const s = A.stats();
  return {
    quality: A.Quality.level,
    failedStep: A.BuildTrace.failedStep,
    error: A.BuildTrace.error ? String(A.BuildTrace.error) : null,
    composerFailed: A.composerFailed,
    meshesSimples: meshes, instancedMeshes: instanced, instancias: insts,
    meshesFundidos: merged,
    trianglesCena: Math.round(tris),
    render: s,
    selftest: A.selftest(),
  };
});

// Sonda de material: pontos suspeitos na captura da chegada.
const matSonda = await page.evaluate(() => {
  const A = window.__AURA;
  A.shot([14.8, 3.0, -13], [9.5, 1.7, -6.5]);
  const pts = {
    'parede-esq':      [-0.62,  0.10],
    'parede-ondulada': [-0.30, -0.05],
    'parede-dir':      [ 0.40,  0.05],
    'piso-entrada':    [-0.05, -0.55],
    'nucleo-pedra':    [ 0.55,  0.62],
    'porta':           [ 0.02, -0.10],
  };
  const out = {};
  for (const k in pts) out[k] = A.matAt(pts[k][0], pts[k][1]);
  out.passes = A.composer ? A.composer.passes.map(p => p.constructor.name) : null;
  return out;
});
console.log('SONDA DE MATERIAL', JSON.stringify(matSonda, null, 1));

// Uma imagem só, para medir exposição/cor sem pagar a bateria inteira.
if (process.env.AURA_SHOT) {
  const [nm, px, py, pz, lx, ly, lz] = process.env.AURA_SHOT.split(',');
  await page.evaluate(([p, l]) => {
    ['loader','hero','top-bar','bottom-bar','commercial','debug-panel','cta-whatsapp','present-controls','ch-overlay','nav-dots','hs-label'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); el.classList.remove('visible','show'); el.style.display = 'none'; }
    });
    window.__AURA.renderer.setPixelRatio(1);
    window.__AURA.shot(p, l);
  }, [[+px, +py, +pz], [+lx, +ly, +lz]]);
  await page.waitForTimeout(800);
  await page.screenshot({ path: nm, timeout: 300000, animations: 'disabled' });
  console.log('imagem:', nm);
}

console.log(JSON.stringify(out, null, 2));
if (logs.length) console.log('--- CONSOLE ---\n' + logs.slice(0, 25).join('\n'));
await browser.close();
