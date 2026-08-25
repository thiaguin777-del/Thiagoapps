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
    lastEnvT = -99;
    applySolarTime(0);
  },
  LP,
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
