// Sonda de diagnóstico: constrói a cena e reporta números, sem gravar
// imagem. Screenshot em SwiftShader custa minutos; isto roda em segundos
// e é o que se usa para validar fusão, contagem de objetos, teste
// estrutural e — com AURA_MAT — qual material está sob um ponto da tela.
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
    if (o.isInstancedMesh) { instanced++; insts += o.count; } else meshes++;
    if (o.userData.merged) merged++;
    const g = o.geometry;
    const n = o.isInstancedMesh ? o.count : 1;
    if (g && g.index) tris += (g.index.count / 3) * n;
    else if (g && g.attributes.position) tris += (g.attributes.position.count / 3) * n;
  });
  A.shot([18, 7.5, 16], [-1, 4.2, 0]);
  return {
    quality: A.Quality.level,
    failedStep: A.BuildTrace.failedStep,
    error: A.BuildTrace.error ? String(A.BuildTrace.error) : null,
    composerFailed: A.composerFailed,
    passes: A.composer ? A.composer.passes.map(p => p.constructor.name) : null,
    meshesSimples: meshes, instancedMeshes: instanced, instancias: insts,
    meshesFundidos: merged, trianglesCena: Math.round(tris),
    render: A.stats(),
    selftest: A.selftest(),
  };
});
console.log(JSON.stringify(out, null, 1));

// AURA_MAT="px,py,pz,lx,ly,lz;nx1,ny1;nx2,ny2;..."
// Posiciona a câmera e diz qual material está sob cada ponto da tela.
if (process.env.AURA_MAT) {
  const [cam, ...pts] = process.env.AURA_MAT.split(';');
  const c = cam.split(',').map(Number);
  const sonda = await page.evaluate(([c, pts]) => {
    const A = window.__AURA;
    A.shot([c[0], c[1], c[2]], [c[3], c[4], c[5]]);
    return pts.map(p => {
      const [nx, ny] = p.split(',').map(Number);
      return { ponto: p, hit: A.matAt(nx, ny) };
    });
  }, [c, pts]);
  console.log('\nSONDA DE MATERIAL');
  for (const s of sonda) {
    const h = s.hit;
    console.log(h
      ? `  (${s.ponto})  ${h.material}  dist ${h.dist}  uv ${h.uv}  fundido ${h.fundido}`
      : `  (${s.ponto})  nada`);
  }
}

if (logs.length) console.log('\n--- CONSOLE ---\n' + logs.slice(0, 20).join('\n'));
await browser.close();
