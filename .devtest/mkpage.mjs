// Gera a página de teste local a partir do HTML de produção.
// Única diferença: importmap e loaders apontam para node_modules em vez do
// CDN (unpkg está bloqueado neste ambiente). O código da cena é idêntico,
// então o que a screenshot mostra é o que o arquivo real renderiza.
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2] || '../CASAAURAV9.html';
const out = process.argv[3] || 'index.html';

let html = readFileSync(new URL(src, import.meta.url), 'utf8');

html = html
  .replaceAll('https://unpkg.com/three@0.160.0/build/three.module.js', '/node_modules/three/build/three.module.js')
  .replaceAll('https://unpkg.com/three@0.160.0/examples/jsm/', '/node_modules/three/examples/jsm/');

// Gancho de teste: expõe os objetos internos do módulo para que o script
// de screenshot possa posicionar a câmera e ler estatísticas do renderer.
// Injetado apenas na página de teste — o arquivo de produção não muda.
const hook = `
window.__AURA = {
  THREE, get scene(){return scene}, get camera(){return camera},
  get renderer(){return renderer}, get controls(){return controls},
  get composer(){return composer}, get composerFailed(){return composerFailed},
  CONFIG, goToChapter, toggleReveal, applySolarTime, setLightMode,
  BuildTrace, Quality, Experience,
  shot(pos, look){
    camera.position.set(pos[0],pos[1],pos[2]);
    controls.target.set(look[0],look[1],look[2]);
    camera.lookAt(look[0],look[1],look[2]);
    controls.update();
    // clampFreeCamera() devolve a câmera para a posição anterior quando
    // ela aparece dentro do envelope da casa vinda de fora. Num teleporte
    // de teste isso zera o enquadramento, então sincronizamos o estado
    // anterior junto — o clamp continua valendo no uso real.
    _camPrev.copy(camera.position);
  },
  // Histograma lido do próprio canvas, no MESMO passo síncrono do
  // render — sem preserveDrawingBuffer o buffer já teria sido limpo se
  // esperássemos o frame seguinte. Isto substitui screenshot+PIL e faz a
  // calibração de luz custar milissegundos em vez de minutos.
  metrics(){
    if (composer && !composerFailed) composer.render(); else renderer.render(scene, camera);
    const src = renderer.domElement;
    const t = document.createElement('canvas');
    t.width = 320; t.height = 180;
    const x = t.getContext('2d');
    x.drawImage(src, 0, 0, t.width, t.height);
    const d = x.getImageData(0, 0, t.width, t.height).data;
    let sr = 0, sg = 0, sb = 0, clip = 0, hot = 0, dark = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      const l = 0.2126*r + 0.7152*g + 0.0722*b;
      sr += r; sg += g; sb += b;
      if (l > 250) clip++;
      if (l > 240) hot++;
      if (l < 12) dark++;
      n++;
    }
    return {
      lum: +((0.2126*sr + 0.7152*sg + 0.0722*sb) / n).toFixed(1),
      clip: +(clip / n * 100).toFixed(2),
      hot: +(hot / n * 100).toFixed(2),
      dark: +(dark / n * 100).toFixed(2),
      br: +((sb - sr) / n).toFixed(1),
    };
  },
  // Aplica um conjunto de parâmetros de luz sem recarregar a página.
  tune(o){
    if (o.sunI !== undefined) LP.day.sunI = o.sunI;
    if (o.hemiI !== undefined) LP.day.hemiI = o.hemiI;
    if (o.amb !== undefined) LP.day.amb = o.amb;
    if (o.envI !== undefined) LP.day.envI = o.envI;
    if (o.exp !== undefined) LP.day.exp = o.exp;
    if (o.rect !== undefined) window.__RECT_K = o.rect;
    lastEnvT = -99;
    applySolarTime(0);
  },
  LP, M,
  // Identifica QUAL material está sob um ponto da tela (coordenada
  // normalizada -1..1). Serve para não diagnosticar artefato por
  // impressão: aponta-se para o defeito e o raycast diz o material.
  matAt(nx, ny){
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hits = rc.intersectObject(scene, true);
    for (const h of hits) {
      const o = h.object;
      if (!o.isMesh || !o.material || o.material.visible === false) continue;
      let nome = '?';
      for (const k in M) if (M[k] === o.material) nome = k;
      return {
        material: nome,
        temMap: !!o.material.map,
        temNormal: !!o.material.normalMap,
        repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
        fundido: !!o.object3D || !!o.userData.merged,
        dist: +h.distance.toFixed(2),
        uv: h.uv ? [+h.uv.x.toFixed(2), +h.uv.y.toFixed(2)] : null,
      };
    }
    return null;
  },
  // Teste estrutural: a fusão de geometria remove centenas de objetos da
  // cena, então é preciso PROVAR que o que sumiu foi só duplicação de
  // draw call e não conteúdo. Verifica volume ocupado, o Modo Corte, a
  // água e as luminárias.
  selftest(){
    const bbox = (o) => {
      const b = new THREE.Box3().setFromObject(o);
      if (!isFinite(b.min.x)) return null;
      const s = b.getSize(new THREE.Vector3());
      return { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2) };
    };
    const r = { grupos: {}, falhas: [] };
    houseGroup.children.forEach((c, i) => {
      const b = bbox(c);
      if (!b) { r.falhas.push('grupo ' + i + ' sem volume'); return; }
      r.grupos['g' + i] = b;
    });

    // Modo Corte: o volume superior tem de continuar existindo e subindo
    r.upperMass = upperMass ? { filhos: upperMass.children.length, bbox: bbox(upperMass) } : null;
    if (!upperMass || upperMass.children.length === 0) r.falhas.push('upperMass vazio — Modo Corte quebrado');
    const y0 = upperMass ? upperMass.position.y : null;
    toggleReveal(true);
    for (let i = 0; i < 200; i++) updateReveal(0.05);
    r.revealSobeAte = upperMass ? +upperMass.position.y.toFixed(2) : null;
    if (upperMass && upperMass.position.y < 6) r.falhas.push('Modo Corte não ergue o volume');
    toggleReveal(false);
    for (let i = 0; i < 200; i++) updateReveal(0.05);
    r.revealVolta = upperMass ? +upperMass.position.y.toFixed(2) : null;

    // Água: o Water.js não pode ter sido fundido
    r.agua = waterObj ? { existe: true, temUniforms: !!(waterObj.material && waterObj.material.uniforms) } : { existe: false };
    if (waterObj && !waterObj.material.uniforms) r.falhas.push('Water.js perdeu uniforms');

    r.luzesReais = lampLights.length;
    r.emissivas = emissiveFixtures.length;
    if (emissiveFixtures.length === 0) r.falhas.push('nenhum material emissivo registrado');

    // Hotspots continuam clicáveis
    r.hotspots = hotspotMeshes.length;
    return r;
  },
  // renderer.info zera a cada render; lido depois do composer ele conta
  // só o quad final. Para medir a cena de verdade, renderiza direto.
  stats(){
    renderer.render(scene, camera);
    const i = renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles,
             geo: i.memory.geometries, tex: i.memory.textures,
             progs: renderer.info.programs ? renderer.info.programs.length : -1 };
  },
  ready: false,
};
`;
html = html.replace(/\ninit\(\)\.catch\(/, `\n${hook}\ninit().then(()=>{window.__AURA.ready=true;}).catch(`);
html = html.replace('</body>', `<script>window.__TEST__=true;</script></body>`);

writeFileSync(new URL(out, import.meta.url), html);
console.log('página de teste gerada:', out, (html.length / 1024 / 1024).toFixed(2) + ' MB');
