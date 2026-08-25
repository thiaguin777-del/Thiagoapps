// Linha de base de performance. Nao adianta atacar "92 programas" sem
// saber o que sao os 92 — a correcao para "cada material tem chave
// propria" e completamente diferente da correcao para "cada variante de
// define do Three.js conta como programa".
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const Q = process.env.AURA_Q || 'ultra';
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p = await b.newPage({viewport:{width:1280,height:720}});
const marcas=[];
p.on('console',m=>{const t=m.text(); if(/\[MARCA\]/.test(t)) marcas.push(t);});
const t0=Date.now();
await p.goto(`http://127.0.0.1:8099/index.html?debug=1&q=${Q}`,{waitUntil:'load',timeout:120000});
await p.waitForFunction(()=>window.__AURA&&window.__AURA.ready,null,{timeout:240000});
const tPronto=Date.now()-t0;

const r = await p.evaluate(() => {
  const A=window.__AURA, R=A.renderer;
  A.shot([18,7.5,16],[-1,4.2,0]);
  // A.stats() renderiza a CENA e le info logo depois. Ler apos
  // composer.render() devolvia 1: o ultimo passe do composer e um quad de
  // tela cheia, e info.render.calls e zerado a cada render.
  const st = A.stats();
  const progs=R.info.programs||[];
  // agrupa as chaves por "familia": o que muda de um programa para o outro
  const chaves=progs.map(pr=>pr.cacheKey||'');
  const porTipo={};
  progs.forEach(pr=>{ const k=pr.name||'?'; porTipo[k]=(porTipo[k]||0)+1; });
  // quantos materiais tem customProgramCacheKey proprio (o "aura<N>")
  let comChaveAura=0, materiais=new Set(), porFeature={};
  A.scene.traverse(o=>{ if(!o.isMesh||!o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
      if(!m||materiais.has(m.uuid))return; materiais.add(m.uuid);
      if(m.userData && m.userData.__auraProgKey) comChaveAura++;
      const f=[m.userData&&m.userData.__indoor?'indoor':'', m.type].filter(Boolean).join('+');
      porFeature[f]=(porFeature[f]||0)+1;
    });});
  // contagem de meshes opacos estaticos que PODERIAM fundir
  let opacosEstaticos=0, porMaterialOpaco={};
  A.scene.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||!o.material) return;
    const m=Array.isArray(o.material)?o.material[0]:o.material;
    if(!m||m.transparent) return;
    if(o.userData.noMerge) return;
    opacosEstaticos++;
    const k=m.uuid.slice(0,8);
    porMaterialOpaco[k]=(porMaterialOpaco[k]||0)+1;
  });
  const multi=Object.values(porMaterialOpaco).filter(v=>v>1);
  const P=A.Perf||{};
  return {
    bootPerEtapa: (P.steps||[]).filter(e=>e[1]>30),
    texturasMs: P.texturasMs?+P.texturasMs.toFixed(0):null,
    texturasN: P.texturasN||null,
    top10Texturas: (P.porTextura||[]).slice().sort((a,b)=>b[1]-a[1]).slice(0,10),
    somaPorTipo: (()=>{const o={};(P.porTextura||[]).forEach(([k,v])=>{o[k]=+((o[k]||0)+v).toFixed(0)});return o;})(),
    tier:A.Quality.level,
    draw:st.calls, tris:st.tris,
    programas:progs.length, texturas:R.info.memory.textures, geos:R.info.memory.geometries,
    porTipo, comChaveAura, materiaisNaCena:materiais.size, porFeature,
    opacosEstaticos,
    materiaisComVariosMeshes:multi.length,
    meshesQuePoderiamFundir: multi.reduce((a,c)=>a+c,0) - multi.length,
    amostraChaves: chaves.slice(0,3).map(c=>c.length>120?c.slice(0,120)+'…':c),
  };
});
console.log('tempo ate __AURA.ready:', tPronto,'ms');
console.log(JSON.stringify(r,null,1));
if(marcas.length) console.log('\nMARCAS:\n'+marcas.join('\n'));
await b.close();
