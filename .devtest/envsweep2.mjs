// LP.day.envI = 0,45 foi calibrado quando o IBL sem oclusao estourava o
// interior: era um freio global posto para salvar a parede de dentro, e o
// exterior pagava a conta. Agora quem cuida do interior e
// applyIndoorOcclusion, que e geometrica — entao o freio global perdeu a
// razao de existir e precisa ser reavaliado.
//
// Piorou tambem porque applyEnvIntensity passou a percorrer a CENA: de 36
// para 92 materiais agendados. Os 56 novos sao quase todos de fora
// (vegetacao, relevo distante, deck, ferragens) e acabaram de levar um
// corte de 55% que nunca tiveram.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p = await b.newPage({viewport:{width:960,height:540}});
await p.goto('http://127.0.0.1:8099/index.html?debug=1&q=high',{waitUntil:'load',timeout:120000});
await p.waitForFunction(()=>window.__AURA&&window.__AURA.ready,null,{timeout:240000});
await p.evaluate(()=>window.__AURA.renderer.setPixelRatio(1));

const CENAS = JSON.parse(process.env.SO || 'null') || {
  'geral (ext)': { cam:[[18,7.5,16],[-1,4.2,0]], zon:{
    ceu:[0.05,0.02,0.95,0.14], casa:[0.30,0.35,0.60,0.55],
    terreno:[0.05,0.80,0.45,0.98], vegetacao:[0.72,0.60,0.99,0.95] } },
  'sala (int)': { cam:[[-8.6,1.6,3.2],[-8.8,1.15,-2.2]], zon:{
    teto:[0.30,0.00,0.70,0.10], parede:[0.80,0.20,0.98,0.70],
    movel:[0.40,0.55,0.60,0.75], piso:[0.30,0.85,0.70,0.99] } },
  'suite (int)': { cam:[[6.6,1.6,3.4],[6.6,1.05,-1.4]], zon:{
    teto:[0.30,0.00,0.70,0.10], parede:[0.80,0.20,0.98,0.70],
    movel:[0.40,0.55,0.60,0.75], piso:[0.30,0.85,0.70,0.99] } },
};

for (const nome in CENAS) {
  const C = CENAS[nome];
  const ks = Object.keys(C.zon);
  console.log(`\n#### ${nome} ####`);
  console.log('  envI | ' + ks.map(k=>k.padStart(9)).join(' ') + ' |  estouro%');
  for (const e of JSON.parse(process.env.E)) {
    const r = await p.evaluate(([cam,zon,e])=>{
      const A=window.__AURA;
      A.LP.day.envI = e;
      A.applySolarTime(0);
      A.shot(cam[0],cam[1]);
      const z = A.zones(zon);
      return { z, m: A.metrics() };
    },[C.cam,C.zon,e]);
    console.log('  '+String(e).padStart(4)+' | '
      + ks.map(k=>String(r.z[k].lum).padStart(9)).join(' ')
      + ' | ' + String(r.m.clip).padStart(6));
  }
}
await b.close();
