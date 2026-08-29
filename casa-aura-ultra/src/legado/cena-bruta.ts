// @ts-nocheck
// ============================================================
// LEGADO EM QUARENTENA — e ele encolhe a cada modulo esculpido
// ------------------------------------------------------------
// Este arquivo e o corpo do CASAAURAV9.html transplantado inteiro. Ele NAO
// foi reescrito de proposito: carrega dezenas de correcoes que so
// apareceram medindo e renderizando, e cada uma custou caro.
//
// So para citar as que morreriam numa reescrita "limpa":
//   - a mascara de oclusao de IBL de interior (parede 185 -> 90)
//   - o tone mapping ACES aplicado no grade, porque o EffectComposer nao
//     o aplica (66,8% do vermelho estourado -> 0%)
//   - a chave de programa por material, sem a qual materiais colapsam
//   - o PBR derivado de campo de altura, com ganho de cavidade FIXO
//   - os cartoes de folha com alphaTest no lugar de cones
//   - a calota de solo do IBL com raio 50, porque fromScene tem far = 100
//
// O @ts-nocheck e temporario e deliberado: o plano e esculpir modulos
// TIPADOS para fora daqui (core/, scenes/, effects/, ui/) e ver este
// arquivo encolher ate sumir. Enquanto ele existir, a experiencia funciona
// em todos os passos da migracao — nunca ha um periodo longo quebrado.
// ============================================================

import * as THREE from 'three';
import _PRESETS_JSON from '../data/presets.json';
import _CAPITULOS_JSON from '../data/chapters.json';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

window.__casaAuraModuleStarted = true;

// ============================================================
// BUILD TRACE
// Rastreia exatamente qual etapa está rodando / falhou, com o erro real.
// É o que permite diferenciar "WebGL indisponível" de "nosso código
// quebrou" — a distinção que o fallback genérico anterior não fazia.
// ============================================================
const BuildTrace = {
  currentStep: 'boot',
  completedSteps: [],
  failedStep: null,
  error: null,
  start(step) { this.currentStep = step; },
  complete(step) { this.completedSteps.push(step); },
  fail(step, err) { this.failedStep = step; this.error = err; },
};

// ============================================================
// CONFIG
// chapters/hotspots começam vazios e são preenchidos por
// buildChaptersAndHotspots() depois que a cena é construída — as posições
// são autorais (coordenadas conhecidas do projeto), não inventadas às
// cegas: cada câmera e hotspot aponta para algo que a função de
// construção correspondente realmente colocou na cena.
// ============================================================
const CONFIG = {
  whatsappThiago: "5561900000000", // placeholder — CTA auto-hides until replaced with a real number
  chapters: [],
  hotspots: [],
};

// ============================================================
// DEVICE / CAPABILITY DETECTION + ADAPTIVE QUALITY
// ============================================================
const Capability = {
  reducedMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  isMobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  cores: navigator.hardwareConcurrency || 4,
  mem: navigator.deviceMemory || 4,
  dpr: window.devicePixelRatio || 1,
};

const QUALITY_PRESETS = {
  ultra:  { pixelRatio: Math.min(Capability.dpr, 2), shadows: true,  shadowMap: 2048, glass: 'full',   waterAnim: true  },
  high:   { pixelRatio: Math.min(Capability.dpr, 1.75), shadows: true,  shadowMap: 1024, glass: 'full',   waterAnim: true  },
  medium: { pixelRatio: Math.min(Capability.dpr, 1.5), shadows: true,  shadowMap: 512,  glass: 'simple', waterAnim: true  },
  low:    { pixelRatio: 1,                              shadows: false, shadowMap: 0,    glass: 'simple', waterAnim: false },
};

const Quality = {
  level: 'high',
  // ?q=ultra|high|medium|low trava o tier e desliga o rebaixamento
  // automático. Existe por uma razão prática de engenharia: sem isso não
  // há como auditar visualmente um tier específico — o renderizador de
  // teste é lento, o rebaixamento dispara, e o que se audita acaba sendo
  // sempre 'low'. Também serve ao corretor que quer forçar 'ultra' num
  // notebook bom para apresentar ao cliente.
  locked: false,
  init() {
    const forced = (location.search.match(/[?&]q=(ultra|high|medium|low)/) || [])[1];
    if (forced) { this.level = forced; this.locked = true; return this.level; }
    if (Capability.isMobile && (Capability.mem <= 4 || Capability.cores <= 4)) this.level = 'medium';
    if (Capability.isMobile && Capability.mem <= 2) this.level = 'low';
    if (!Capability.isMobile && Capability.mem >= 8 && Capability.cores >= 8) this.level = 'ultra';
    return this.level;
  },
  get() { return QUALITY_PRESETS[this.level]; },
  downgrade() {
    if (this.locked) return false;
    const order = ['ultra', 'high', 'medium', 'low'];
    const i = order.indexOf(this.level);
    if (i < order.length - 1) { this.level = order[i + 1]; return true; }
    return false;
  },
};

// ============================================================
// EXPERIENCE STATE MACHINE
// ============================================================
const Experience = {
  state: 'loading', // loading -> ready -> explore -> cinematic|presenting -> commercial
  timers: new Set(),
  cinematicToken: 0,
  set(s) { this.state = s; },
  is(s) { return this.state === s; },
  setTimeout(fn, ms) {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  },
  clearAllTimers() { this.timers.forEach(id => clearTimeout(id)); this.timers.clear(); },
  // Token-based cinematic tracking: every chained step() closure captures
  // the token that was current when cinematic mode started. Both starting
  // and stopping bump the counter, so any already-scheduled step from a
  // previous run fails isCurrentCinematic() and becomes a no-op — no
  // orphaned timer can move the camera after the user has left the mode.
  startCinematic() { this.cinematicToken++; return this.cinematicToken; },
  isCurrentCinematic(token) { return this.state === 'cinematic' && token === this.cinematicToken; },
  stopCinematic() {
    this.cinematicToken++;
    this.clearAllTimers();
    if (this.state === 'cinematic') this.state = 'explore';
  },
};

let scene, camera, renderer, controls, clock;
let houseGroup;
let upperMass = null;
let revealActive = false, revealAmount = 0, revealTarget = 0, revealCamMove = false;
// Voo de capítulo disparado FORA do modo cinemático — quando o cliente
// clica um ponto da barra de capítulos enquanto orbita à vontade. Precisa
// de flag própria pelo mesmo motivo que `revealCamMove` tem a dele: o
// `animate()` só chama `lerpCam()` em cinematic/presenting, e o
// `clampFreeCamera()` só isenta quem se declara. Ver `goToChapter`.
let chapterCamMove = false;
let sunLight, ambientLight, hemiLight, poolLight;
let lampLights = [];
let envRT = null;
let rectLights = [];
let Assets = null;
let audioSys = null;
// Ganho da calota de solo do mapa de ambiente. Ver a nota longa no ponto
// onde o PMREM e gerado: o rebote de solo tem de escalar com a luz do ceu.
// 2,2 saiu de varredura: com a calota finalmente dentro do frustum, o
// desvio B-R da parede em sombra vai de +24,9 (ganho 0) a -30 (ganho 3,6),
// cruzando o neutro perto de 1,8. 2,2 deixa a sombra levemente QUENTE, que
// e como o olho espera rebote de solo — e nao azul, que era o defeito.
const envGroundGain = { value: 2.2 };
let sky = null, skyNightFade = null, skyNightColor = null, skyPMREM = null, envScene = null, envGround = null, envDirty = false, lastEnvT = -99;
// Intervalo minimo entre duas geracoes de PMREM. Ver a nota no laco de
// render: o custo e alto e o ganho visual entre uma geracao e outra e
// baixo, entao ele entra em orcamento em vez de rodar quando quiser.
const PMREM_MS = 900;
// Tiers altos usam RectAreaLight (LTC) na janela; medium/low nao. Ver a
// nota onde as luzes de janela sao criadas.
let usaLTC = true;
// Quanto de rebote de interior entra no lugar da luz de janela quando o
// LTC esta desligado. MEDIDO em medium, comparando com o high: com
// fill = 3,0 o teto le 125,2 contra 127,5 e a parede 155,4 contra 153,5.
// Movel e piso ficam ~25% abaixo, porque o rebote e isotropico e nao
// reproduz o gradiente direcional do vao — e o preco conhecido da troca.
const COMPENSA_LTC = 2.9;
let _ultimoPMREM = -1e9;
let waterObj = null;
let composer = null, gradePass = null, grainPass = null, bloomPass = null, gtaoPass = null, composerFailed = false;
let currentChapter = 0;
let targetCamPos = new THREE.Vector3(), targetLookAt = new THREE.Vector3();
let currentLightMode = 'day';
let solarTime = 0;
let solarDragging = false;
let raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
let hotspotMeshes = [];
let waterMaterial = null, glassMaterial = null, waterNormalMap = null;
let materialCentroids = {};
let modelBounds = null;
let camCurve = null, camCurveT = 0, camCurveTarget = 0;
let renderLoopActive = true;
let lastFrameTime = performance.now(), frameCount = 0, currentFPS = 60, slowFrameStreak = 0;
let _tQuadroAnterior = performance.now();

const $ = id => document.getElementById(id);
const container = $('canvas-wrap');
const DEBUG = location.search.includes('debug=1');


// ============================================================
// PIPELINE DE ASSETS EXTERNOS
// ------------------------------------------------------------
// O projeto não tem textura fotográfica nem modelo GLB — verificado:
// o pacote npm do Three.js não traz uma imagem sequer, e este ambiente
// não alcança bibliotecas de textura. A resposta NÃO é desistir do
// requisito: é construir o sistema que os recebe, funcional e testado,
// degradando para o procedural atual quando não houver nada.
//
// Como usar: coloque os arquivos em ./assets/ (ou aponte ASSET_BASE para
// um CDN) seguindo os nomes de ASSET_MANIFEST. O que existir substitui
// automaticamente o procedural; o que faltar continua procedural.
// Nada quebra pela ausência.
// ============================================================
const ASSET_BASE = (new URLSearchParams(location.search).get('assets') || './assets/').replace(/\/?$/, '/');

// ============================================================
// TELEMETRIA — inerte ate ser configurada
// ------------------------------------------------------------
// O produto promete 60fps "em qualquer hardware". Sem medir no parque
// real, isso e uma esperanca: o iPad do corretor e o Galaxy do cliente
// nao estao aqui, e nenhum benchmark local substitui os dois.
//
// Manda UM pacote por sessao, ao sair, com o que decide a promessa: fps
// medio, o percentil baixo (que dói mais que a media), tempo ate a cena
// aparecer, tier escolhido e o contexto do aparelho.
//
// Sem SUPABASE_URL preenchido nao faz nada — nenhuma requisicao, nenhum
// erro no console. E o padrao: quem clonar o repo nao dispara telemetria
// para lugar nenhum sem saber.
// ============================================================
const TELEMETRIA = {
  url: '',            // https://<ref>.supabase.co
  chave: '',          // publishable key (anon). NAO a service key.
  slug: 'casa-aura',
  enviado: false,
};

function enviarTelemetria() {
  if (!TELEMETRIA.url || !TELEMETRIA.chave || TELEMETRIA.enviado) return;
  if (Perf.quadros < 120) return;   // sessao curta demais para significar algo
  TELEMETRIA.enviado = true;
  let mem = null, nucleos = null;
  try { mem = navigator.deviceMemory || null; nucleos = navigator.hardwareConcurrency || null; } catch (e) {}
  const corpo = JSON.stringify([{
    sessao: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    slug: TELEMETRIA.slug,
    tier: Quality.level,
    fps_medio: Perf.frameMs ? +(1000 / Perf.frameMs).toFixed(1) : null,
    fps_p05: Perf.piorFps || null,
    quadro_ms: Perf.frameMs ? +Perf.frameMs.toFixed(2) : null,
    draw_calls: renderer ? renderer.info.render.calls : null,
    programas: renderer ? renderer.info.programs.length : null,
    ms_ate_pronto: Perf.bootMs ? Math.round(Perf.bootMs) : null,
    ua: navigator.userAgent.slice(0, 300),
    memoria_gb: mem, nucleos: nucleos,
    dpr: window.devicePixelRatio,
    tela: window.innerWidth + 'x' + window.innerHeight,
    webgl2: !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2),
    max_textura: renderer && renderer.capabilities ? renderer.capabilities.maxTextureSize : null,
  }]);
  // sendBeacon sobrevive ao fechamento da aba, que e exatamente quando
  // este pacote precisa sair. fetch normal seria cancelado.
  try {
    const u = TELEMETRIA.url.replace(/\/?$/, '') + '/rest/v1/analytics';
    if (navigator.sendBeacon) {
      navigator.sendBeacon(u + '?apikey=' + encodeURIComponent(TELEMETRIA.chave),
        new Blob([corpo], { type: 'application/json' }));
    } else {
      fetch(u, { method: 'POST', keepalive: true, body: corpo,
        headers: { 'Content-Type': 'application/json', apikey: TELEMETRIA.chave } });
    }
  } catch (e) { /* telemetria nunca pode derrubar a experiencia */ }
}
window.addEventListener('pagehide', enviarTelemetria);


const ASSET_MANIFEST = {
  // --- Texturas PBR (substituem as texturas de canvas) ---
  textures: {
    // repeat: materiais aplicados em box/rbox usam [1,1] porque a escala
    // vem da UV em metros (applyWorldUV/TILE_M). Só gramado e terraço,
    // que vivem em PlaneGeometry com UV 0..1, mantêm repetição própria.
    concreto:   { base: 'concrete_diff.jpg', normal: 'concrete_nor.jpg', rough: 'concrete_rough.jpg', repeat: [1, 1] },
    cumaru:     { base: 'wood_dark_diff.jpg', normal: 'wood_dark_nor.jpg', rough: 'wood_dark_rough.jpg', repeat: [1, 1] },
    ipe:        { base: 'wood_deck_diff.jpg', normal: 'wood_deck_nor.jpg', rough: 'wood_deck_rough.jpg', repeat: [1, 1] },
    madeiraClara:{ base: 'wood_light_diff.jpg', normal: 'wood_light_nor.jpg', rough: 'wood_light_rough.jpg', repeat: [1, 1] },
    travertino: { base: 'travertine_diff.jpg', normal: 'travertine_nor.jpg', rough: 'travertine_rough.jpg', repeat: [1, 1] },
    bancada:    { base: 'marble_diff.jpg', normal: 'marble_nor.jpg', rough: 'marble_rough.jpg', repeat: [1, 1] },
    estuque:    { base: 'stucco_diff.jpg', normal: 'stucco_nor.jpg', rough: 'stucco_rough.jpg', repeat: [1, 1] },
    gramado:    { base: 'grass_diff.jpg', normal: 'grass_nor.jpg', rough: null, repeat: [450, 450] },
    terraco:    { base: 'pavers_diff.jpg', normal: 'pavers_nor.jpg', rough: 'pavers_rough.jpg', repeat: [7, 5] },
  },
  // --- Modelos GLB (substituem o mobiliário procedural) ---
  // pivô no CHÃO, centro em XZ, escala em METROS, eixo -Z = frente.
  models: {
    sofa:        { file: 'sofa.glb',        slot: 'createSofa' },
    armchair:    { file: 'armchair.glb',    slot: 'createArmchair' },
    diningSet:   { file: 'dining_set.glb',  slot: 'createDiningSet' },
    bed:         { file: 'bed.glb',         slot: 'createBed' },
    lounger:     { file: 'lounger.glb',     slot: 'createOutdoorLounger' },
    plant:       { file: 'plant.glb',       slot: 'createPottedPlant' },
    tree:        { file: 'tree.glb',        slot: 'tree' },
  },
  audio: { ambient: 'ambient_garden.mp3', water: 'water_loop.mp3' },
};

// ?models=1 liga os GLB embutidos modelados no Blender no lugar do
// mobiliário procedural. Declarado no topo porque também decide se vale
// a pena sequer decodificá-los.
const USE_GLB = new URLSearchParams(location.search).get('models') === '1';

function createAssetSystem() {
  const A = {
    textures: {}, models: {}, loaded: { textures: 0, models: 0 },
    available: false, errors: [],
  };

  let gltfLoader = null;
  try {
    gltfLoader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
    gltfLoader.setDRACOLoader(draco);
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/basis/');
    ktx2.detectSupport(renderer);
    gltfLoader.setKTX2Loader(ktx2);
  } catch (e) {
    A.errors.push('loaders: ' + e.message);
  }

  const texLoader = new THREE.TextureLoader();

  // Carrega uma textura; resolve com null se não existir (silencioso de
  // propósito: ausência de asset é o caso normal, não um erro).
  function tryTexture(file, srgb, repeat) {
    return new Promise((resolve) => {
      if (!file) return resolve(null);
      try {
      texLoader.load(ASSET_BASE + file,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          if (repeat) t.repeat.set(repeat[0], repeat[1]);
          // Mesma regra do bug do deck espelhado: mapa de COR é sRGB,
          // mapa de DADO (normal, rugosidade) é linear. Explícito nos
          // dois casos para não depender do padrão do loader.
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          A.loaded.textures++;
          resolve(t);
        },
        undefined,
        () => resolve(null));
      } catch (e) { resolve(null); }   // URL inválida, CORS, etc: ignora
    });
  }

  function tryModel(file) {
    return new Promise((resolve) => {
      if (!gltfLoader || !file) return resolve(null);
      try {
        gltfLoader.load(ASSET_BASE + file,
          (gltf) => { A.loaded.models++; resolve(gltf.scene); },
          undefined,
          () => resolve(null));
      } catch (e) { resolve(null); }
    });
  }

  // Carrega tudo em paralelo. Timeout curto: se os assets não existem,
  // a experiência não pode ficar esperando.
  // Carrega os GLB embutidos (modelados no Blender). Assets externos em
  // ./assets/ ainda sobrescrevem estes, se existirem.
  A.loadEmbedded = function () {
    // MEDIDO: os GLB embutidos eram decodificados de base64 E passados
    // pelo GLTFLoader em TODO carregamento, mesmo com A.model() devolvendo
    // null por padrão — ou seja, ~900 KB de decode e parse jogados fora em
    // cada abertura, no celular do cliente. Agora só carrega quando
    // ?models=1 realmente vai consumi-los.
    if (!USE_GLB || !gltfLoader) return Promise.resolve();
    return loadEmbeddedModelPayload().then((PAYLOAD) => {
      if (!PAYLOAD) return;
      const jobs = [];
      for (const key in PAYLOAD) {
        jobs.push(new Promise((resolve) => {
        try {
          const bin = atob(PAYLOAD[key]);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          gltfLoader.parse(buf.buffer, '', (gltf) => {
            A.models[key] = gltf.scene; A.loaded.models++; resolve();
          }, () => resolve());
        } catch (e) { resolve(); }
        }));
      }
      return Promise.all(jobs);
    });
  };

  A.load = async function (timeoutMs) {
    // Os modelos embutidos carregam primeiro e em bloco próprio: uma
    // falha ao buscar asset EXTERNO não pode derrubá-los junto. Foi
    // exatamente esse o bug encontrado renderizando.
    // Teto de 2 s, não 10.
    //
    // Este await está no caminho crítico: nada da cena começa antes dele.
    // O payload embutido é OPCIONAL — sem ele o mobiliário procedural
    // assume, que é o caminho normal. Um cliente numa rede ruim, ou um
    // deploy onde assets/models/ não existe, esperava DEZ SEGUNDOS de tela
    // de carregamento por um arquivo que talvez nem devesse existir.
    // 2 s é generoso para um arquivo local e barato quando ele não vem.
    try {
      await Promise.race([A.loadEmbedded(), new Promise(r => setTimeout(r, 2000))]);
    } catch (e) { A.errors.push('embedded: ' + e.message); }
    // ------------------------------------------------------------
    // SONDA ÚNICA ANTES DE PEDIR 34 ARQUIVOS
    // MEDIDO no console do teste: 34 requisições 404 em TODO
    // carregamento (9 texturas x 3 mapas + 7 modelos), porque a pasta
    // ./assets/ normalmente não existe — é opcional por projeto. Cada
    // 404 é uma ida e volta de rede antes de a cena poder começar.
    // Agora uma sonda só decide: se o primeiro arquivo não está lá, a
    // pasta não está lá, e as outras 33 requisições não acontecem.
    // ------------------------------------------------------------
    // ...e nem a sonda, quando ela não pode dar certo.
    //
    // Em `file://` o navegador trata a origem como opaca e BLOQUEIA por
    // CORS a leitura de qualquer imagem vizinha — exista ela ou não. A
    // sonda então nunca informa nada, e o preço é um erro vermelho de
    // CORS no console a cada abertura. Isso importa porque a entrega em
    // arquivo único (`npm run build:unico`) é feita exatamente para ser
    // aberta com duplo clique: um erro logo na abertura de um arquivo
    // que na verdade está perfeito é o pior tipo de ruído — o que faz
    // duvidar de coisa que está certa.
    //
    // As texturas externas são opcionais por projeto e o caminho
    // procedural cobre tudo, então pular a sonda aqui não perde nada.
    if (location.protocol === 'file:') {
      A.available = (A.loaded.textures + A.loaded.models) > 0;
      return A;
    }

    const sonda = await tryTexture('concrete_diff.jpg', true, null);
    if (!sonda) {
      A.available = (A.loaded.textures + A.loaded.models) > 0;
      return A;
    }

    const jobs = [];
    for (const key in ASSET_MANIFEST.textures) {
      const t = ASSET_MANIFEST.textures[key];
      jobs.push(Promise.all([
        tryTexture(t.base, true, t.repeat),
        tryTexture(t.normal, false, t.repeat),
        tryTexture(t.rough, false, t.repeat),
      ]).then(([base, normal, rough]) => {
        if (base) A.textures[key] = { base, normal, rough };
      }));
    }
    for (const key in ASSET_MANIFEST.models) {
      jobs.push(tryModel(ASSET_MANIFEST.models[key].file)
        .then(obj => { if (obj) A.models[key] = obj; }));
    }
    try {
      await Promise.race([
        Promise.all(jobs.map(j => j.catch(() => null))),
        new Promise(r => setTimeout(r, timeoutMs || 6000)),
      ]);
    } catch (e) { A.errors.push('external: ' + e.message); }
    A.available = (A.loaded.textures + A.loaded.models) > 0;
    return A;
  };

  // Aplica as texturas carregadas sobre os materiais procedurais.
  A.applyToMaterials = function (M) {
    let n = 0;
    for (const key in A.textures) {
      const mat = M[key];
      if (!mat) continue;
      const set = A.textures[key];
      mat.map = set.base;
      // preserva o normalScale autoral: sobrescrever com (1,1) fazia a
      // textura externa entrar com relevo muito mais forte que a procedural
      if (set.normal) mat.normalMap = set.normal;
      if (set.rough) mat.roughnessMap = set.rough;
      mat.needsUpdate = true;
      n++;
    }
    return n;
  };

  // Devolve um clone do modelo se existir; senão null (o chamador cai no
  // construtor procedural).
  // Os modelos do Blender ficaram, nesta primeira passada, com silhueta
  // PIOR que o mobiliário procedural (que passou por muitas iterações de
  // refino). Entregar assim seria uma regressão conhecida. Ficam
  // disponíveis atrás de ?models=1 para comparação lado a lado no
  // aparelho real, e como base para uma próxima rodada de modelagem.
  A.model = function (key) {
    if (!USE_GLB) return null;
    const src = A.models[key];
    if (!src) return null;
    const c = src.clone(true);
    c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return c;
  };

  return A;
}

// ============================================================
// VENTO — vegetação viva
// Deslocamento no vertex shader via onBeforeCompile: a copa balança
// sutilmente, a base fica firme. Custo zero de CPU e nenhum draw call
// extra. Amplitude baixa de propósito — brisa, não tempestade.
// ============================================================
// Intensidade da luz de janela. Calibrada por medição no enquadramento
// interno (ver .devtest/tune.mjs): o interior recebia quase só o IBL do
// céu, e por isso lia frio e apagado apesar de o forro de madeira estar
// quente. A luz de janela representa o céu MAIS o rebote do piso claro
// externo, que é o que de fato aquece uma sala com fachada de vidro.
// MEDIDO no enquadramento interno, depois de corrigida a direção:
//   1,8 -> luminância 144,1 | estouro 0,55% | desvio B-R +0,6 (neutro)
//   3,4 -> luminância 156,9 | estouro 0,56% | desvio B-R -4,6 (quente)
//   12  -> luminância 196,6 | estouro 32,4% | desvio B-R  -18 (estourado)
//
// 2,6 saiu daquela medição e estava errado — mas o erro era da medição,
// não do número. Ela lia a MÉDIA do quadro inteiro, e num interior a média
// é dominada pela parede: com a parede estourada pelo IBL sem oclusão, o
// quadro já chegava a 156 de luminância e qualquer luz de janela a mais
// só empurrava a parede para o estouro. O sofá, a 45, nunca apareceu na
// conta. Medindo por FAIXA (zones()), com a parede sob controle:
//
//   rect | sala: teto/parede/móvel/piso | suíte: idem
//   2,6  |   23   87  39  25            |   22   75  33  13   <- o breu
//   10   |   45  175 116  66            |   41  132 102  45
//   20   |   74  218 192 120            |   67  208 142  87   <- parede indo
//   35   |  118  228 216 187            |  106  246 181 140   <- chapado
//
// 10 é onde o móvel fica legível sem a parede encostar no estouro. A
// diferença entre sala e suíte é legítima — vão de 13 m contra 7,4 m —
// e é atacada abrindo a janela lateral, não subindo a intensidade.
const RECT_K = 10;

const windUniform = { value: 0 };
function applyWind(material, amplitude) {
  ensureOwnProgramKey(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniform;
    shader.uniforms.uWindAmp = { value: amplitude };
    shader.vertexShader = 'uniform float uWindTime;\nuniform float uWindAmp;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '  vec3 wOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
        '#else',
        '  vec3 wOrigin = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);',
        '#endif',
        '  float phase = wOrigin.x * 0.35 + wOrigin.z * 0.27;',
        // altura relativa: só a parte de cima balança
        '  float h = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);',
        '  float sway = sin(uWindTime * 0.9 + phase) * 0.6 + sin(uWindTime * 1.7 + phase * 1.9) * 0.4;',
        '  transformed.x += sway * uWindAmp * h * h;',
        '  transformed.z += sway * uWindAmp * 0.55 * h * h;',
      ].join('\n'));
  };
  material.needsUpdate = true;
}

// ============================================================
// ÁUDIO AMBIENTE
// Opcional, silencioso por padrão, respeitando autoplay policy: só
// inicia após interação real do usuário. Se o asset não existir, o
// botão simplesmente não aparece.
// ============================================================
function createAudioSystem() {
  const S = { enabled: false, ready: false, listener: null, sounds: {} };
  S.init = function () {
    if (S.listener) return;
    try {
      S.listener = new THREE.AudioListener();
      camera.add(S.listener);
      const loader = new THREE.AudioLoader();
      const defs = [
        { key: 'ambient', file: ASSET_MANIFEST.audio.ambient, vol: 0.35, pos: null },
        { key: 'water', file: ASSET_MANIFEST.audio.water, vol: 0.5, pos: [-5.6, 0.5, 10.4] },
      ];
      defs.forEach(d => {
        loader.load(ASSET_BASE + d.file, (buf) => {
          let snd;
          if (d.pos) {
            snd = new THREE.PositionalAudio(S.listener);
            snd.setRefDistance(6); snd.setMaxDistance(30);
            const anchor = new THREE.Object3D();
            anchor.position.set(d.pos[0], d.pos[1], d.pos[2]);
            anchor.add(snd); scene.add(anchor);
          } else {
            snd = new THREE.Audio(S.listener);
          }
          snd.setBuffer(buf); snd.setLoop(true); snd.setVolume(d.vol);
          S.sounds[d.key] = snd;
          S.ready = true;
          const btn = $('btn-audio');
          if (btn) btn.style.display = '';
        }, undefined, () => { /* asset ausente: silêncio, sem erro */ });
      });
    } catch (e) { if (DEBUG) console.warn('Áudio indisponível:', e); }
  };
  S.toggle = function () {
    if (!S.ready) return false;
    S.enabled = !S.enabled;
    Object.values(S.sounds).forEach(s => {
      if (S.enabled) { if (!s.isPlaying) s.play(); } else { if (s.isPlaying) s.pause(); }
    });
    return S.enabled;
  };
  return S;
}


// ============================================================
// MOBILIÁRIO MODELADO NO BLENDER — CARGA SOB DEMANDA
// ------------------------------------------------------------
// MEDIDO: o bloco base64 destes 9 GLB ocupava 1.072.723 caracteres —
// 82,8% do arquivo inteiro — e NÃO era usado em nenhum carregamento
// normal: A.model() devolve null a menos que ?models=1, porque na
// primeira passada estes modelos ficaram com silhueta pior que o
// mobiliário procedural.
//
// Ou seja: todo cliente que abria a experiência baixava 1 MB de dados
// que a cena descartava. Num celular em rede móvel isso é o item mais
// caro do carregamento inteiro.
//
// Agora o payload vive em ./assets/models/embedded-models.js e só é
// buscado quando ?models=1 realmente vai consumi-lo. A capacidade não
// foi removida — foi tirada do caminho crítico. Os mesmos modelos estão
// também como .glb soltos em ./assets/models/, prontos para reabrir no
// Blender e substituir o procedural quando estiverem melhores.
// ============================================================
function loadEmbeddedModelPayload() {
  if (typeof window.CASA_AURA_MODELS !== 'undefined') return Promise.resolve(window.CASA_AURA_MODELS);
  return new Promise((resolve) => {
    const sc = document.createElement('script');
    sc.src = './assets/models/embedded-models.js';
    sc.onload = () => resolve(window.CASA_AURA_MODELS || null);
    sc.onerror = () => resolve(null);   // ausente: cai no procedural
    document.head.appendChild(sc);
  });
}

// ============================================================
// INIT
// ============================================================
async function init() {
  Quality.init();
  document.body.dataset.quality = Quality.level;

  // Watchdog: se por qualquer motivo a construção da cena não terminar
  // em 20s, mostra o fallback em vez de deixar a pessoa olhando pra uma
  // barra de carregamento parada para sempre.
  let initDone = false;
  window.setTimeout(() => { if (!initDone) showFallback('init-timeout'); }, 20000);

  clock = new THREE.Clock();
  scene = new THREE.Scene();
  scene.background = null; // o mesh do Sky.js é o fundo agora
  // CORRIGIDO: densidade de nevoa calibrada para a escala real do terreno.
  // FogExp2 usa fator = 1 - exp(-(densidade * distancia)^2). Com a
  // densidade anterior (0,01155), a 300 m o expoente ja era -12 — ou
  // seja, nevoa 100%: o relevo distante e a mata de fundo eram apagados
  // por completo e o horizonte virava uma faixa de cor chapada colada
  // num ceu quase branco. E a razao de o mundo parecer terminar mesmo
  // depois de o terreno ter sido ampliado para 900 m.
  //
  // A cor tambem mudou: a nevoa precisa ser a cor do CEU JUNTO AO
  // HORIZONTE (quase branca de dia), nao um azul medio, senao a emenda
  // entre terreno e ceu continua aparecendo como degrau de valor.
  scene.fog = new THREE.FogExp2(0xdbe7ef, 0.0033);

  camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(20, 14, 20); // provisório — corrigido para a escala real assim que o modelo carrega

  try {
    renderer = new THREE.WebGLRenderer({ antialias: Quality.level !== 'low', powerPreference: 'high-performance' });
  } catch (e) {
    return showFallback('webgl-init-failed', e);
  }
  if (!renderer || !renderer.getContext()) return showFallback('no-context');
  // Painel de debug ativado cedo (antes de buildScene) para que, se algo
  // falhar durante a construção, o rastro de etapas já esteja visível em
  // tempo real — não adianta só mostrar isso depois de um sucesso.
  if (DEBUG) setupDebugPanel();

  // ============================================================
  // CÉU FÍSICO + ENVIRONMENT DERIVADO DELE
  // ------------------------------------------------------------
  // ANTES: fundo de cor sólida + RoomEnvironment (um "estúdio" branco)
  // como environment map. Era a causa raiz do estouro branco na água e
  // no vidro, e o motivo de nenhum ajuste de material surtir efeito real:
  // tudo refletia uma caixa branca.
  //
  // AGORA: Sky.js — espalhamento atmosférico Rayleigh/Mie de verdade,
  // por shader, sem nenhum asset. O sol do heliodon alimenta o céu, e o
  // PMREM é gerado A PARTIR DO CÉU. Ou seja: os materiais passam a
  // refletir o céu real daquela hora do dia. É essa a mudança que faz
  // material responder a luz de verdade.
  // ============================================================
  sky = new Sky();
  sky.scale.setScalar(45000);

  // ------------------------------------------------------------
  // ESCURECIMENTO DO CÉU À NOITE
  // ENCONTRADO renderizando o capítulo "Visão Final" (luz 'night'): a
  // cena lia como fim de tarde, não como noite — o céu continuava cinza
  // claro atrás de uma casa já iluminada por dentro.
  //
  // Causa: o modelo de Preetham do Sky.js não trata sol ABAIXO do
  // horizonte. Com o sol em -10° ele continua devolvendo um céu de
  // crepúsculo claro, por mais que se mexa em turbidez e rayleigh.
  //
  // Correção: um multiplicador no fim do shader do céu, controlado pelo
  // heliodon. Não é truque de cor — é o mesmo papel que a atmosfera faz,
  // aplicado onde o modelo analítico deixa de valer.
  // ------------------------------------------------------------
  // O Sky usa ShaderMaterial. Para ShaderMaterial o Three.js monta o
  // programa a partir de material.uniforms / material.fragmentShader
  // DIRETAMENTE — o objeto entregue a onBeforeCompile não é a fonte dos
  // uniforms, e por isso a primeira tentativa por lá não teve efeito
  // nenhum (o céu continuou claro à noite no render). Aqui o uniform e o
  // shader são alterados no próprio material, antes da primeira compilação.
  // REVISADO depois de ver a noite de verdade (com a luz do capítulo
  // aplicada): MULTIPLICAR o céu por um fator só o levava a preto, e a
  // casa passava a se recortar contra o vazio. O modelo de Preetham
  // colapsa com o sol abaixo do horizonte — não é caso de atenuar, é
  // caso de SUBSTITUIR.
  //
  // Agora o shader MISTURA o céu analítico com a cor de céu noturno da
  // parada atmosférica atual. De dia vale Preetham puro; à noite vale o
  // azul profundo autoral, que é o que recorta a silhueta do edifício.
  skyNightFade = { value: 1 };
  skyNightColor = { value: new THREE.Color(0x121b30) };
  sky.material.uniforms.uSkyFade = skyNightFade;
  sky.material.uniforms.uSkyNight = skyNightColor;
  sky.material.fragmentShader = 'uniform float uSkyFade;\nuniform vec3 uSkyNight;\n' +
    sky.material.fragmentShader.replace(
      'gl_FragColor = vec4( retColor, 1.0 );',
      'gl_FragColor = vec4( mix( uSkyNight, retColor, uSkyFade ), 1.0 );');
  sky.material.needsUpdate = true;
  scene.add(sky);

  skyPMREM = new THREE.PMREMGenerator(renderer);
  skyPMREM.compileEquirectangularShader();

  // Cena auxiliar usada SÓ para gerar o mapa de ambiente: céu + calota de
  // solo. A calota é uma meia-esfera virada para dentro, com material
  // básico (não recebe luz — ela É a luz que o solo devolve).
  envScene = new THREE.Scene();
  // RAIO 50, E ISSO É O QUE FAZ A CALOTA EXISTIR.
  //
  // Ela tinha raio 4000 e NUNCA ENTROU no mapa de ambiente. PMREMGenerator
  // .fromScene(scene, sigma, near, far) tem far = 100 por padrão: a calota
  // estava inteira fora do frustum e era descartada, silenciosamente. O
  // céu continuava aparecendo porque o shader do Sky força a profundidade
  // para o plano distante, então ele é sempre desenhado.
  //
  // Ou seja: a correção de "IBL sem rebote de solo", registrada como
  // resolvida, na prática nunca chegou a rodar — e as superfícies em
  // sombra seguiram lendo azuis, com desvio B−R de +20 a +29 nas paredes
  // da chegada, que são quase 100% IBL.
  //
  // Encontrado varrendo o ganho da calota de 1 a 10 e vendo a parede não
  // se mexer um único nível (184,2 -> 184,3). Botão desligado, de novo.
  // O raio de uma calota usada só para gerar IBL é arbitrário: o que
  // importa é ela caber no frustum e envolver a origem.
  envGround = new THREE.Mesh(
    new THREE.SphereGeometry(50, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x8a7f6a, side: THREE.BackSide, fog: false })
  );
  envScene.add(envGround);

  const q = Quality.get();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  renderer.shadowMap.enabled = q.shadows;
  if (q.shadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderLoopActive = false;
    if (DEBUG) console.warn('WebGL context lost');
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    // Achado de auditoria: só marcar a flag como true não bastava — o
    // loop de animação precisa ser explicitamente re-registrado no
    // renderer, ou a cena fica congelada mesmo com o contexto de volta.
    renderLoopActive = true;
    clock.getDelta();
    renderer.setAnimationLoop(animate);
    if (DEBUG) console.warn('WebGL context restored');
  });

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !Capability.reducedMotion;
  controls.dampingFactor = 0.045;
  controls.minDistance = 2;
  controls.maxDistance = 46;
  controls.maxPolarAngle = Math.PI / 2 - 0.10;
  controls.target.set(0, 2, 0);
  controls.enabled = false;

  const pctBar = document.querySelector('.load-bar');
  const pctText = $('load-pct');
  const setPct = (p) => {
    pctText.textContent = Math.round(p) + '%';
    if (pctBar) pctBar.style.setProperty('--pct', Math.round(p) + '%');
  };

  setPct(8);
  setupLighting();
  setPct(12);

  // FASE DE ASSETS: tenta carregar externos. Se não houver nenhum, segue
  // com o procedural sem atraso perceptível.
  BuildTrace.start('Assets externos');
  try {
    Assets = createAssetSystem();
    await Assets.load(Capability.isMobile ? 4000 : 6000);
    if (DEBUG) console.info('Assets externos:', Assets.loaded);
  } catch (e) {
    if (DEBUG) console.warn('Pipeline de assets falhou, seguindo procedural:', e);
    Assets = null;
  }
  BuildTrace.complete('Assets externos');
  setPct(15);

  try {
    await buildScene((frac) => setPct(15 + frac * 60));
  } catch (e) {
    if (DEBUG) console.error('Falha ao construir a cena da Casa Aura:', e);
    return showFallback('scene-build-failed', e);
  }
  setPct(75);

  adaptMaterialsToQuality();
  composer = setupPostProcessing();
  // buildHotspots() NAO e mais chamada: os marcadores agora sao DOM, em
  // src/ui/HotspotManager.ts. Chamar as duas coisas punha 20 malhas 3D na
  // cena JUNTO com os 10 marcadores em DOM — interface duplicada, clique
  // duplicado, e a economia de draw calls que a troca prometia nunca
  // acontecia. `hotspotMeshes` fica vazio, entao o raycast de clique e o
  // laco de visibilidade viram no-ops sem precisar de mais nenhuma guarda.
  // buildHotspots();
  setPct(85);
  buildNavDots();
  setPct(93);
  setupEvents();
  setPct(100);

  Experience.setTimeout(() => {
    $('loader').classList.add('hidden');
  }, 250);

  setupVisibilityHandling();

  Experience.set('ready');
  initDone = true;
  startRenderLoop();
}

const FALLBACK_REASONS = {
  'no-context':          { user: 'Não foi possível iniciar o WebGL neste navegador.', tech: 'WebGL genuinamente indisponível (getContext falhou) — não é um bug da aplicação.' },
  'webgl-init-failed':   { user: 'Não foi possível iniciar o WebGL neste navegador.', tech: 'new THREE.WebGLRenderer() lançou exceção — verificar suporte a WebGL do dispositivo.' },
  'scene-build-failed':  { user: 'A construção da cena 3D falhou.', tech: 'Erro interno da aplicação durante buildScene() — ver etapa e stack abaixo. NÃO é falta de suporte a WebGL.' },
  'init-exception':      { user: 'Ocorreu um erro ao iniciar a experiência.', tech: 'Exceção não tratada em algum ponto de init() fora de buildScene().' },
  'init-timeout':        { user: 'O carregamento demorou mais do que o esperado.', tech: 'init() não terminou em 20s — possível travamento silencioso.' },
  'context-lost':        { user: 'A conexão com a placa de vídeo foi perdida.', tech: 'Evento webglcontextlost dado como definitivo (sem restauração a tempo).' },
};

function showFallback(reason, err) {
  const info = FALLBACK_REASONS[reason] || { user: 'Não foi possível iniciar a visualização 3D.', tech: 'Motivo não catalogado: ' + reason };
  if (DEBUG) console.error('Casa Aura fallback:', reason, err || BuildTrace.error || '');

  const loader = $('loader');
  if (loader) loader.classList.add('hidden');
  const hero = $('hero');
  if (hero) hero.classList.add('hidden');
  const fb = $('fallback');
  if (fb) fb.classList.add('show');

  const fbText = document.querySelector('.fb-text');
  if (fbText) {
    if (DEBUG) {
      const realErr = err || BuildTrace.error;
      let msg = info.user + '\n\n[debug] causa: ' + info.tech;
      if (BuildTrace.failedStep) msg += '\n[debug] etapa que falhou: ' + BuildTrace.failedStep;
      if (BuildTrace.completedSteps.length) msg += '\n[debug] etapas concluídas antes: ' + BuildTrace.completedSteps.join(', ');
      if (realErr) msg += '\n[debug] ' + realErr.constructor.name + ': ' + realErr.message;
      fbText.textContent = msg;
      fbText.style.whiteSpace = 'pre-wrap';
    } else {
      fbText.textContent = info.user;
    }
  }
  renderLoopActive = false;
}

// ============================================================
// LIGHTING
// Rig principal (sol + hemisfério + ambiente + luz da piscina) mais um
// conjunto de pontos de luz de fachada em posições autorais conhecidas.
// poolLight é reposicionada em buildPoolAndDeck() para a coordenada real
// da piscina; as demais luzes de ambiente (abajures, pendentes, lareira)
// são coletadas de dentro dos próprios móveis via collectLamps().
// ============================================================
function setupLighting() {
  const q = Quality.get();

  // RectAreaLight: luz que emana de um PLANO, não de um ponto. É como
  // luz de janela realmente entra num ambiente — e é a técnica padrão de
  // archviz para vãos envidraçados. Não projeta sombra e não conta no
  // orçamento de PointLight, mas é cara: só 2, nas duas fachadas de vidro.
  RectAreaLightUniformsLib.init();
  // ------------------------------------------------------------
  // BUG CORRIGIDO — a luz de janela iluminava PARA FORA
  // MEDIDO com .devtest/tune.mjs, variando a intensidade destas luzes de
  // 3,4 até 400: a panorâmica EXTERNA subia de 119,9 para 140,7 de
  // luminância e o enquadramento INTERNO não mexia um décimo (129,3 ->
  // 129,2). Ou seja: elas emitiam, mas para o lado errado.
  //
  // Causa: RectAreaLight emite ao longo do -Z LOCAL (é o que lookAt()
  // orienta). Sem rotação o -Z local já apontava para dentro da casa; o
  // rotation.y = PI virava a emissão para +Z, para o jardim. A técnica
  // descrita logo acima — luz de plano para vão envidraçado, o padrão de
  // archviz — nunca chegou a acontecer no interior. Era essa a razão de
  // fundo de os ambientes lerem frios: a única luz que chegava neles era
  // o IBL azul do céu.
  //
  // Agora usa lookAt() para dentro: explícito, sem depender de lembrar a
  // convenção de eixo.
  // ------------------------------------------------------------
  // z = 5,6 — 40 cm DENTRO da sala, e é onde tem de ficar.
  //
  // Cheguei a mover para 6,15, do lado de fora do vidro, com o argumento
  // de que a luz representa o céu e portanto pertence ao lado de fora.
  // O render desmentiu na hora: o pano de vidro do térreo virou uma CHAPA
  // BRANCA opaca. Óbvio em retrospecto — uma luz de área a 15 cm de um
  // plano ilumina esse plano antes de qualquer outra coisa, e o plano era
  // o próprio vidro.
  //
  // Medido no enquadramento da fachada, luminância do pano de vidro:
  //   luz em z = 6,15  ->  245   (chapa branca)
  //   luz em z = 5,6   ->  179
  //   luz em z = 5,0   ->  178   (não compensa afastar mais)
  // A rugosidade do vidro não participa disso: 0,040 e 0,075 dão 245,3 e
  // 245,2 no primeiro caso. Eram duas suspeitas e só uma era a causa.
  const windowLights = [
    { w: 13.0, h: 2.8, pos: [-4.15, 1.7, 5.6], alvo: [-4.15, 1.4, -2.0] },  // fachada sul social
    { w: 7.4,  h: 2.8, pos: [8.0, 1.7, 5.6],  alvo: [8.0, 1.4, -2.0] },     // fachada sul suíte
  ];
  // As janelas laterais oeste e leste existem na arquitetura desde sempre
  // (westWindow e eastWindow, em buildArchitecture) e nunca tiveram luz.
  // O resultado media-se: com uma única abertura ao sul, o fundo dos dois
  // cômodos caía, e a suíte — vão de 7,4 m contra 13 m da social — ficava
  // sistematicamente mais escura que a sala na mesma calibração.
  //
  // Duas aberturas por cômodo também é o que dá modelado: luz cruzada
  // revela o volume dos móveis; uma fonte só achata tudo contra o fundo.
  // Fica fora dos tiers baixos porque cada RectAreaLight custa uma
  // avaliação LTC por fragmento.
  if (Quality.level === 'ultra' || Quality.level === 'high') {
    windowLights.push(
      // k = 0,5: são vãos pequenos voltados a leste/oeste, que enxergam
      // menos céu que a fachada sul inteira em vidro. Sem esse fator elas
      // ficavam a 1,5 m do forro e deixavam uma poça quente no teto —
      // apareceu no render do cap. 4 antes de a sonda apontar a causa.
      { w: 3.2, h: 1.6, pos: [-10.9, 1.8, -3.0], alvo: [-4.0, 1.5, -3.0], k: 0.5 },  // janela oeste, social
      { w: 3.2, h: 1.6, pos: [11.9, 1.8, -3.0],  alvo: [6.0, 1.5, -3.0], k: 0.5 },   // janela leste, suíte
    );
  }
  // ------------------------------------------------------------
  // NENHUMA RectAreaLight EM medium/low
  // ------------------------------------------------------------
  // RectAreaLight usa aproximação LTC: duas texturas de lookup e uma
  // avaliação de forma analítica POR FRAGMENTO, por luz. É dos custos de
  // shader mais altos que o Three.js oferece, e ele cai inteiro sobre o
  // aparelho mais fraco — que é justamente o iPad do corretor e o celular
  // do cliente, os dois em medium/low.
  //
  // Nos tiers altos elas ficam: é lá que a luz de janela com modelado
  // direcional se paga, e desktop aguenta.
  //
  // Em medium/low quem faz o trabalho é o termo de rebote da máscara de
  // interior, que já existe e custa três linhas de aritmética no mesmo
  // shader que já roda. Perde-se o gradiente direcional do vão; mantém-se
  // o comodo iluminado e quente, que é o que a imagem precisa entregar.
  // A compensação está em LP.*.indoorFill (ver applySolarTime).
  usaLTC = (Quality.level === 'ultra' || Quality.level === 'high');
  if (!usaLTC) windowLights.length = 0;
  windowLights.forEach(wl => {
    const rl = new THREE.RectAreaLight(0xf2ede2, 0, wl.w, wl.h);
    rl.position.set(wl.pos[0], wl.pos[1], wl.pos[2]);
    rl.lookAt(wl.alvo[0], wl.alvo[1], wl.alvo[2]);
    rl.userData.k = wl.k === undefined ? 1 : wl.k;
    scene.add(rl);
    rectLights.push(rl);
  });

  ambientLight = new THREE.AmbientLight(0xffffff, 0.24);
  scene.add(ambientLight);

  hemiLight = new THREE.HemisphereLight(0xddeeff, 0x3a3226, 0.42);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(0xfff5e6, 2.0);
  sunLight.position.set(24, 30, 16);
  sunLight.castShadow = q.shadows;
  if (q.shadows) {
    sunLight.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    // Frustum alargado junto com a correção do arco solar: com o sol em
    // 11° na golden hour a sombra da casa passa de 20 m, e o volume
    // anterior (±26 m, far 90) cortava a sombra no meio do gramado.
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 130;
    sunLight.shadow.camera.left = -32;
    sunLight.shadow.camera.right = 32;
    sunLight.shadow.camera.top = 28;
    sunLight.shadow.camera.bottom = -28;
    sunLight.shadow.bias = -0.0006;
    sunLight.shadow.normalBias = 0.025;
    sunLight.shadow.radius = 2.0;   // PCFSoft: borda de sombra menos dura
  }
  scene.add(sunLight);

  poolLight = new THREE.PointLight(0x55b6cc, 0, 14);
  scene.add(poolLight);

  // Uplight de fachada: reduzido de 8 para 1 (a entrada). Os demais eram
  // custo de shader por fragmento sem ganho visual proporcional.
  [[9.5, 1.0, -6.6]].forEach((p) => {
    const pl = new THREE.PointLight(0xffe6c2, 0, 7, 2);
    pl.position.set(p[0], p[1], p[2]);
    scene.add(pl);
    lampLights.push(pl);
  });

  // Define o orçamento de luzes reais conforme o tier de qualidade.
  lightBudgetLeft = LIGHT_BUDGET[Quality.level] || 8;
}

// CORRIGIDO — sobre-exposição por contagem tripla da luz do céu.
// MEDIDO no render: a fachada NORTE, que está em sombra própria ao
// meio-dia, saía em branco puro (255). Isso é impossível fisicamente e
// era o que dava o aspecto "estourado" das capturas.
//
// Causa: a luz do céu estava sendo somada TRÊS vezes — o environment
// PMREM gerado do próprio céu (IBL), mais a HemisphereLight, mais a
// AmbientLight. Cada uma sozinha é defensável; as três juntas dobram o
// preenchimento e apagam toda a modelagem de volume.
//
// Correção: o IBL do céu passa a ser a fonte principal de preenchimento
// (é o que tem direção e oclusão de verdade), a hemisférica vira um
// resto para o rebote do solo, e a ambiente cai para quase nada — só o
// suficiente para nenhum canto fechar em preto absoluto.
//
// envI é novo: escala o envMapIntensity de TODOS os materiais ao longo
// do dia. Sem isso o céu noturno continuava iluminando a casa como se
// fosse meio-dia, porque envMapIntensity é constante por material.
// As paradas atmosféricas vivem em src/data/presets.json. O JSON é a
// ÚNICA fonte: nada aqui duplica os valores, então não há como as duas
// versões divergirem. As cores chegam como "#rrggbb" (legível e
// editável à mão) e viram inteiro uma vez, no carregamento.
const _CORES_LP = ['bg', 'fog', 'sunC', 'hemiSky', 'hemiGnd'];
const LP = (() => {
  const fora = {};
  for (const [nome, parada] of Object.entries(_PRESETS_JSON)) {
    if (nome.startsWith('_')) continue;
    const d = {};
    for (const [k, v] of Object.entries(parada)) {
      d[k] = _CORES_LP.includes(k) ? parseInt(String(v).slice(1), 16) : v;
    }
    fora[nome] = d;
  }
  return fora;
})();

// ============================================================
// O HELIODON — a ideia assinatura da Casa Aura
// ------------------------------------------------------------
// Um heliodon é o instrumento clássico de arquitetura: uma fonte de luz
// móvel que percorre a trajetória do sol sobre a maquete física, para o
// arquiteto estudar sombra e orientação solar. Aqui ele vira o próprio
// mecanismo de navegação da experiência.
//
// Em vez de 4 botões que trocam 4 estados desconectados, existe UMA
// trajetória solar contínua. O sol percorre um arco elíptico real, as
// sombras varrem o travertino de verdade, e as 4 atmosferas nomeadas
// (Dia / Golden / Blue Hour / Noite) são apenas paradas nesse percurso.
// A arquitetura nunca muda — só a luz sobre ela. Que é exatamente o
// argumento que um arquiteto usa pra vender orientação solar.
// ============================================================

// Paradas nomeadas ao longo do dia. t=0 meio-dia, t=1 noite fechada.
const SOLAR_STOPS = [
  { t: 0.00, key: 'day' },
  { t: 0.52, key: 'golden' },
  { t: 0.76, key: 'blue' },
  { t: 1.00, key: 'night' },
];
const SOLAR_T = { day: 0.00, golden: 0.52, blue: 0.76, night: 1.00 };

// Ângulos do arco solar. Azimute varre de leste para oeste; elevação
// desce de alta (meio-dia) até abaixo do horizonte (noite).
// CORRIGIDO: a elevação era interpolada LINEARMENTE de 68° a -12°, então
// a parada "golden" (t=0,52) caía em 26° de altura — que não é golden
// hour, é meio da tarde. Sol alto não modela volume: achata a fachada e
// encurta a sombra, e era parte do motivo de a casa parecer maquete.
//
// Agora a elevação tem chaves próprias, ancoradas nas mesmas paradas do
// heliodon: 'day' já entra em 56° (sol de meio-dia com direção legível),
// 'golden' em 11° (luz rasante, sombra longa, fachada raspada de lado) e
// 'blue' logo abaixo, com o sol quase no horizonte.
const SUN_KEYS = [
  { t: 0.00, az: 44,  el: 56 },
  { t: 0.52, az: 133, el: 11 },
  { t: 0.76, az: 174, el: 2.2 },
  { t: 1.00, az: 205, el: -10 },
];
const SUN_ARC = { radius: 62 };

function sunPositionAt(t) {
  t = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < SUN_KEYS.length - 2 && t > SUN_KEYS[i + 1].t) i++;
  const a = SUN_KEYS[i], b = SUN_KEYS[i + 1];
  let f = (t - a.t) / ((b.t - a.t) || 1);
  f = f * f * (3 - 2 * f);
  const az = (a.az + (b.az - a.az) * f) * Math.PI / 180;
  const el = (a.el + (b.el - a.el) * f) * Math.PI / 180;
  const R = SUN_ARC.radius;
  return new THREE.Vector3(
    Math.cos(az) * Math.cos(el) * R,
    Math.sin(el) * R,
    Math.sin(az) * Math.cos(el) * R
  );
}

const _lerp = (a, b, f) => a + (b - a) * f;

// Interpola TODOS os parâmetros atmosféricos entre as duas paradas
// vizinhas — é isso que transforma 4 estados discretos num contínuo.
// Cores de rascunho pré-alocadas: solarStateAt() roda a cada frame
// durante o arraste do percurso solar, então alocar Color novo a cada
// campo geraria lixo de GC contínuo. Reutilizamos os mesmos objetos.
const _sc = {
  bg: new THREE.Color(), fog: new THREE.Color(), sunC: new THREE.Color(),
  hemiSky: new THREE.Color(), hemiGnd: new THREE.Color(),
  a: new THREE.Color(), b: new THREE.Color(),
};
function _mix(target, hexA, hexB, f) {
  _sc.a.setHex(hexA); _sc.b.setHex(hexB);
  return target.lerpColors(_sc.a, _sc.b, f);
}

function solarStateAt(t) {
  t = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < SOLAR_STOPS.length - 2 && t > SOLAR_STOPS[i + 1].t) i++;
  const a = SOLAR_STOPS[i], b = SOLAR_STOPS[i + 1];
  const span = (b.t - a.t) || 1;
  let f = (t - a.t) / span;
  f = f * f * (3 - 2 * f); // smoothstep — evita transição linear "dura"
  const A = LP[a.key], B = LP[b.key];
  return {
    bg: _mix(_sc.bg, A.bg, B.bg, f),
    fog: _mix(_sc.fog, A.fog, B.fog, f),
    fogD: _lerp(A.fogD, B.fogD, f),
    sunC: _mix(_sc.sunC, A.sunC, B.sunC, f),
    sunI: _lerp(A.sunI, B.sunI, f),
    hemiSky: _mix(_sc.hemiSky, A.hemiSky, B.hemiSky, f),
    hemiGnd: _mix(_sc.hemiGnd, A.hemiGnd, B.hemiGnd, f),
    hemiI: _lerp(A.hemiI, B.hemiI, f),
    amb: _lerp(A.amb, B.amb, f),
    exp: _lerp(A.exp, B.exp, f),
    envI: _lerp(A.envI, B.envI, f),
    indoorFill: _lerp(A.indoorFill, B.indoorFill, f),
    pool: _lerp(A.pool, B.pool, f),
    lamp: _lerp(A.lamp, B.lamp, f),
    glassGlow: _lerp(A.glassGlow, B.glassGlow, f),
    waterGlow: _lerp(A.waterGlow, B.waterGlow, f),
  };
}

function applySolarTime(t) {
  solarTime = Math.max(0, Math.min(1, t));
  const s = solarStateAt(solarTime);

  // ---- CÉU FÍSICO ----
  // O sol do heliodon alimenta diretamente o shader atmosférico. Ao
  // anoitecer o próprio espalhamento escurece o céu — não é uma cor
  // trocada à mão, é o sol passando do horizonte.
  const sunDir = sunPositionAt(solarTime).clone().normalize();
  if (sky) {
    const u = sky.material.uniforms;
    u.sunPosition.value.copy(sunDir);
    // turbidez e rayleigh mudam ao longo do dia: céu limpo e azul ao
    // meio-dia, mais denso e avermelhado ao entardecer
    u.turbidity.value = 2.5 + solarTime * 9.0;
    u.rayleigh.value = 0.9 + solarTime * 2.6;
    u.mieCoefficient.value = 0.004 + solarTime * 0.010;
    u.mieDirectionalG.value = 0.80 - solarTime * 0.15;
    // Curva de escurecimento: intacta até a golden hour, cai forte da
    // blue hour em diante. Os expoentes seguem a queda real de luz do
    // crepúsculo, que é muito mais rápida do que a intuição sugere.
    if (skyNightFade) {
      const t = solarTime;
      // Curva suavizada depois de renderizar a blue hour com a luz do
      // capítulo aplicada de verdade: a versão anterior começava na
      // golden hour e chegava a 3,5%, e somada ao envI baixo apagava a
      // cena inteira. Agora só age no último trecho e não vai a zero —
      // céu de noite real não é preto, tem claridade residual.
      // mistura progressiva a partir da blue hour; a cor de destino é a
      // própria cor de fundo da parada atmosférica, então o céu noturno
      // segue a paleta autoral em vez de um valor solto no shader
      skyNightFade.value = t < 0.70 ? 1.0
        : Math.max(0.0, 1.0 - (t - 0.70) / 0.30);
      skyNightColor.value.copy(s.bg);
    }
  }
  // A água é MeshPhysicalMaterial (ver buildPoolAndDeck): escurece e
  // esfria ao anoitecer em vez de trocar uniform de shader.
  if (waterObj && waterObj.material && !waterObj.material.uniforms) {
    waterObj.material.color.setHex(solarTime > 0.7 ? 0x18576b : 0x3f9aad);
  }
  // O environment é regenerado a partir do céu (não a cada frame: só
  // quando o sol andou o suficiente para valer o custo).
  if (sky && skyPMREM && Math.abs(solarTime - lastEnvT) > 0.06) {
    lastEnvT = solarTime;
    envDirty = true;
  }

  scene.fog.color.copy(s.fog);
  scene.fog.density = s.fogD;
  sunLight.color.copy(s.sunC);
  sunLight.intensity = s.sunI;
  sunLight.position.copy(sunPositionAt(solarTime));
  hemiLight.color.copy(s.hemiSky);
  hemiLight.groundColor.copy(s.hemiGnd);
  hemiLight.intensity = s.hemiI;
  ambientLight.intensity = s.amb;
  // Escala o IBL do céu sobre TODOS os materiais. Sem isto, o
  // envMapIntensity é constante e o céu de meia-noite continua
  // preenchendo a casa com a mesma força do meio-dia — a razão de a
  // cena noturna nunca ficar realmente escura.
  applyEnvIntensity(s.envI);
  // O rebote de interior sobe com a noite: de dia ele repoe o pouco de
  // ceu que a mascara tirou; a noite ele E a luz do comodo — o rebote das
  // paredes claras sob as luminarias, que nenhuma das 8 point lights do
  // orcamento consegue fazer sozinha.
  // A compensacao segue a MESMA curva da luz que ela substitui: some ao
  // anoitecer junto com a luz de janela, quando as luminarias assumem.
  indoorU.fill.value = s.indoorFill
    + (usaLTC ? 0 : COMPENSA_LTC * Math.max(0, 1.0 - solarTime * 1.25));
  // A piscina acende junto com a casa. Ao entardecer o sol rasante já não
  // alcança o fundo da bacia e a lâmina fecharia em preto — e piscina
  // preta no capítulo que existe para vender a piscina é o oposto do
  // objetivo. Fazendo o revestimento acompanhar a rampa das luminárias,
  // ela vira o elemento luminoso da composição noturna, que é
  // exatamente o que uma piscina de alto padrão faz ao vivo.
  if (M && M.revestPiscina) M.revestPiscina.emissiveIntensity = 0.35 + s.lamp * 1.15;
  // Balizadores de fachada acendem junto com o resto da casa.
  uplightUniform.value = s.lamp * 1.30;
  renderer.toneMappingExposure = s.exp;
  // A exposicao real vai pelo grade: com o composer no caminho, o
  // toneMappingExposure do renderer nao chega a tela (ver a nota longa em
  // ColorGradeShader). A linha acima fica porque o tier 'low' renderiza
  // SEM composer e depende dela.
  if (gradePass) gradePass.uniforms.exposure.value = s.exp;
  poolLight.intensity = s.pool;
  // WOW #3 — Acendimento escalonado ao anoitecer.
  // Todas as luminárias subindo juntas denuncia que é um único slider.
  // Cada luminária ganha um limiar próprio, então a casa acende cômodo a
  // cômodo conforme o sol cai — como uma casa real sendo ocupada.
  // luz de janela cai junto com o sol e esfria ao entardecer
  for (let i = 0; i < rectLights.length; i++) {
    // window.__RECT_K é um ponto de ajuste deliberado: permite calibrar a
    // luz de janela pelo console no aparelho real, ou pela varredura
    // automatizada em .devtest/tune.mjs, sem recompilar nada.
    rectLights[i].intensity = Math.max(0, (1.0 - solarTime * 1.25)) * (window.__RECT_K || RECT_K)
      * (rectLights[i].userData.k === undefined ? 1 : rectLights[i].userData.k);
    rectLights[i].color.setHex(solarTime < 0.5 ? 0xf2ede2 : 0xf5d9b4);
  }

  for (let i = 0; i < lampLights.length; i++) {
    const L = lampLights[i];
    if (L.userData.turnOn === undefined) {
      L.userData.turnOn = 0.42 + ((i * 0.6180339887) % 1) * 0.40; // sequência áurea: espalha sem agrupar
    }
    const ramp = Math.max(0, Math.min(1, (solarTime - L.userData.turnOn) / 0.13));
    L.intensity = s.lamp * (ramp * ramp * (3 - 2 * ramp));
  }

  // Luminárias emissivas (fora do orçamento de luz real): o material
  // brilha sem custo de iluminação. Também escalonado no anoitecer.
  for (let i = 0; i < emissiveFixtures.length; i++) {
    const m = emissiveFixtures[i];
    if (!m) continue;
    if (m.__turnOn === undefined) m.__turnOn = 0.42 + ((i * 0.6180339887) % 1) * 0.40;
    const r = Math.max(0, Math.min(1, (solarTime - m.__turnOn) / 0.13));
    m.emissiveIntensity = Math.min(1.6, s.lamp) * (r * r * (3 - 2 * r)) * 1.1;
  }

  // CORRIGIDO renderizando a 'Visão Final' com a luz do capítulo: à noite
  // o glassGlow em 0,32 transformava cada pano de vidro num painel âmbar
  // CHAPADO. O vidro deixava de mostrar o interior — que é justamente o
  // que ele deveria revelar — e a casa virava um punhado de retângulos
  // luminosos boiando no preto. O brilho do vidro tem de ser um resto,
  // não a fonte: quem ilumina a cena noturna são as luminárias internas.
  if (glassMaterial) { glassMaterial.emissive.setHex(0xffdcae); glassMaterial.emissiveIntensity = s.glassGlow; }
  if (waterMaterial) { waterMaterial.emissive.setHex(0x2aa0bb); waterMaterial.emissiveIntensity = s.waterGlow; }

  // rótulo da hora + posição do indicador no trilho
  updateGradeForSolarTime(solarTime);

  const label = $('solar-label');
  if (label) label.textContent = solarLabelFor(solarTime);
  const thumb = $('solar-thumb');
  if (thumb) thumb.style.left = (solarTime * 100) + '%';
  const fill = $('solar-fill');
  if (fill) fill.style.width = (solarTime * 100) + '%';
  const track = $('solar-track');
  if (track) track.setAttribute('aria-valuenow', Math.round(solarTime * 100));

  // marca o botão da atmosfera mais próxima como ativo
  let nearest = 'day', best = 2;
  for (const k in SOLAR_T) { const d = Math.abs(SOLAR_T[k] - solarTime); if (d < best) { best = d; nearest = k; } }
  currentLightMode = nearest;
  document.querySelectorAll('.light-btn').forEach(b => b.classList.toggle('active', b.dataset.light === nearest && best < 0.06));
}

// Cada material guarda seu envMapIntensity autoral como base; o
// heliodon multiplica essa base, então a relação entre materiais
// (vidro reflete mais que estuque) é preservada em qualquer horário.
//
// Achado medindo: a cena tem 134 materiais, mas M — o registro nomeado —
// tem 36. Os outros 98 nascem soltos dentro dos builders (luminárias,
// vegetação, livros, quadros, relevo distante) e nunca foram registrados.
// Iterando só Object.keys(M), 98 materiais atravessavam o dia inteiro com
// o envMapIntensity do instante em que foram construídos: à noite ainda
// refletiam o ambiente na intensidade de meio-dia.
//
// Agora a lista sai da CENA, que é onde os materiais de fato estão. O
// custo é uma travessia única — a lista continua sendo montada uma vez só.
let _envMats = null;
function applyEnvIntensity(k) {
  if (!_envMats) {
    const vistos = new Set();
    _envMats = [];
    const registra = (mat) => {
      if (!mat || vistos.has(mat.uuid) || mat.envMapIntensity === undefined) return;
      vistos.add(mat.uuid);
      mat.userData.baseEnvI = mat.envMapIntensity;
      _envMats.push(mat);
    };
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (Array.isArray(o.material)) o.material.forEach(registra); else registra(o.material);
    });
    // M pode conter material que ainda não está na cena (tier medium/low
    // troca o vidro depois); registrar os dois lados não custa nada.
    if (M) Object.keys(M).forEach((key) => registra(M[key]));
    if (DEBUG) console.info('envMapIntensity agendado em', _envMats.length, 'materiais');
  }
  for (let i = 0; i < _envMats.length; i++) {
    const mat = _envMats[i];
    mat.envMapIntensity = mat.userData.baseEnvI * k;
  }
}

function solarLabelFor(t) {
  // rótulo de hora legível — 12h ao meio-dia até ~21h na noite fechada
  const hour = 12 + t * 9;
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60 / 5) * 5;
  return String(h).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// Transição animada até uma parada nomeada (usada pelos 4 botões e pelos
// capítulos). Mantém a mesma assinatura de antes — nada que já chamava
// setLightMode() precisou mudar.
let solarAnimId = 0;
function setLightMode(mode, dur) {
  const target = SOLAR_T[mode];
  if (target === undefined) return;
  dur = dur || 1.8;
  const from = solarTime;
  const myId = ++solarAnimId;
  if (dur <= 0.02 || Capability.reducedMotion) { applySolarTime(target); return; }
  // ACHADO MEDINDO: a transição avançava `0,016 / dur` por QUADRO, ou
  // seja, assumia 60 fps cravados. Quem roda em 30 fps leva o DOBRO do
  // tempo pedido — 3,6 s numa transição de 1,8 s — e é justamente o
  // aparelho móvel que o resto do projeto passa o tempo protegendo.
  //
  // Apareceu aqui de forma escandalosa: nesta máquina, sem GPU, a 0,1
  // quadro por segundo, os 1,8 s viravam DEZENOVE MINUTOS. A varredura
  // final registrou `luz: "day", solar: 0` no capítulo Piscina, que pede
  // `golden` — não porque o capítulo esteja errado, mas porque a
  // transição mal tinha começado 34 s depois.
  //
  // Relógio de verdade em vez de contagem de quadros. `dt` limitado a
  // 0,05 s para que uma engasgada não dê um salto na luz.
  let e = 0;
  let anterior = performance.now();
  const tick = () => {
    if (myId !== solarAnimId) return; // outra transição assumiu
    const agora = performance.now();
    const dt = Math.min((agora - anterior) / 1000, 0.05);
    anterior = agora;
    e += dt / dur;
    if (e > 1) e = 1;
    const k = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
    applySolarTime(_lerp(from, target, k));
    if (e < 1) requestAnimationFrame(tick);
  };
  tick();
}

function adaptMaterialsToQuality() {
  // ------------------------------------------------------------
  // ALPHATEST MAIS AGRESSIVO NOS TIERS BAIXOS
  // Cartao de folha com alphaTest e custo de PREENCHIMENTO puro: cada
  // pixel do cartao e rasterizado e so entao descartado. Numa mata de
  // milhares de cartoes sobrepostos, o mesmo pixel de tela e processado
  // dezenas de vezes. Subir o limiar descarta mais cedo e corta borda de
  // folha — que a essa distancia, e nesses aparelhos, ninguem resolve.
  if (Quality.level === 'medium' || Quality.level === 'low') {
    const alvo = Quality.level === 'low' ? 0.62 : 0.55;
    ['copaArvore', 'copaArvore2', 'copaArvore3', 'arbusto', 'graminea'].forEach((k) => {
      if (M[k] && M[k].alphaTest) { M[k].alphaTest = alvo; M[k].needsUpdate = true; }
    });
  }

  const q = Quality.get();
  if (q.glass === 'full') return;

  // O vidro continua usando transmission (que força um passe extra de
  // render no Three.js) — desligar isso é o maior ganho em GPU fraca.
  if (glassMaterial) {
    glassMaterial.transmission = 0;
    glassMaterial.transparent = true;      // só agora a opacidade assume
    glassMaterial.opacity = 0.42;
    glassMaterial.roughness = Math.max(glassMaterial.roughness, 0.12);
    glassMaterial.needsUpdate = true;
  }

  // A água não usa mais transmission. Em aparelho fraco, abre mão do
  // normal map de ondulação (leitura de textura por fragmento) e do
  // clearcoat, mantendo cor e transparência — continua parecendo água.
  if (waterMaterial) {
    waterMaterial.clearcoat = 0;
    if (q.glass === 'simple' && Quality.level === 'low') {
      waterMaterial.normalMap = null;
      waterMaterial.needsUpdate = true;
    }
  }
}

// ============================================================
// PÓS-PROCESSAMENTO
// Vinheta conduz o olho ao centro, grain dá textura fotográfica e o
// color grade dá temperatura. O bloom tem threshold alto de propósito:
// só as luminárias e a água iluminada "respiram" à noite — o estuque
// claro NÃO pode bloomar, senão a fachada estoura de dia.
// ============================================================
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, intensity: { value: 0.35 }, color: { value: new THREE.Color(0x0a0908) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: [
    'uniform sampler2D tDiffuse; uniform float intensity; uniform vec3 color; varying vec2 vUv;',
    'void main(){ vec4 tex=texture2D(tDiffuse,vUv); vec2 c=vUv-0.5; float d=length(c);',
    'float v=smoothstep(0.45,1.35,d*(1.0+intensity));',
    'gl_FragColor=vec4(mix(tex.rgb,color,v*intensity),tex.a); }'
  ].join('\n')
};
// ============================================================
// COLOR GRADE — e o lugar onde o TONE MAPPING passou a acontecer
// ------------------------------------------------------------
// ACHADO MEDINDO, e é o defeito de imagem mais grave desta base:
//
//   renderer.toneMapping = ACESFilmicToneMapping   (configurado)
//   desligar o tone mapping por completo           -> imagem IDÊNTICA
//   renderer.toneMappingExposure de 0,86 para 0,20 -> imagem IDÊNTICA
//   as mesmas duas trocas com renderPass direto na tela -> FUNCIONAM
//
// Quando o EffectComposer entra no caminho, a cena é renderizada para um
// render target e o Three.js só aplica tone mapping e conversão de espaço
// de cor na saída PARA A TELA. O alvo intermediário guarda valor linear, e
// nada no resto da cadeia mapeia isso de volta. O que chega ao monitor é
// linear CEIFADO em 1,0 — não tone-mapeado.
//
// O sintoma: 66,8% do canal vermelho da bancada estourado na golden hour,
// realce sem rolloff, e a paleta inteira empurrada para a saturação. E o
// agendamento de exposição das quatro paradas atmosféricas (0,875 / 0,86 /
// 0,98 / 1,05) nunca fez efeito nenhum em ultra, high e medium — só em
// low, que é o único tier sem composer.
//
// Passei a sessão anterior calibrando LUZ contra um pipeline que ceifava.
// Cada vez que uma parede "estourava", o que eu via era a falta do
// rolloff, e eu respondia baixando a fonte.
//
// A correção é fazer o que o composer deixou de fazer, no último ponto
// onde a imagem ainda é linear: exposição, depois ACES, e só então o
// grade — que agora opera em 0..1, como um grade deve operar.
// ============================================================
const ColorGradeShader = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.08 }, contrast: { value: 1.12 },
              warmth: { value: 0.3 }, lift: { value: 0.012 }, exposure: { value: 1.0 } },
  vertexShader: VignetteShader.vertexShader,
  fragmentShader: [
    'uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast;',
    'uniform float warmth; uniform float lift; uniform float exposure; varying vec2 vUv;',
    'void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb;',
    // exposição sobre o valor LINEAR, que é o único ponto em que ela
    // significa "quanta luz entrou"
    'c *= exposure;',
    // ACES aproximado (Narkowicz 2015) — a mesma curva que o Three.js
    // aplicaria se o composer não estivesse no meio. É ela que faz o
    // realce ROLAR para o branco em vez de bater no teto.
    'c = clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14), 0.0, 1.0);',
    // daqui para baixo c está em 0..1 e o grade opera como sempre operou
    'c = c + lift*(1.0-c);',
    'c = (c-0.5)*contrast+0.5;',
    'float l=dot(c,vec3(0.299,0.587,0.114)); c=mix(vec3(l),c,saturation);',
    'c.r += warmth*0.04; c.b -= warmth*0.04;',
    'gl_FragColor=vec4(clamp(c,0.0,1.0),1.0); }'
  ].join('\n')
};
const FilmGrainShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.02 }, time: { value: 0 } },
  vertexShader: VignetteShader.vertexShader,
  fragmentShader: [
    'uniform sampler2D tDiffuse; uniform float amount; uniform float time; varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'void main(){ vec4 tex=texture2D(tDiffuse,vUv);',
    'float n=hash(vUv*800.0+time*12.0)-0.5;',
    'gl_FragColor=vec4(tex.rgb+n*amount,tex.a); }'
  ].join('\n')
};

function setupPostProcessing() {
  // low: sem pós-processamento nenhum (render direto). É o tier onde
  // cada passe extra de tela custa caro demais.
  if (Quality.level === 'low') return null;
  const c = new EffectComposer(renderer);
  c.addPass(new RenderPass(scene, camera));

  // ------------------------------------------------------------
  // OCLUSÃO DE AMBIENTE (GTAO)
  // O que mais denunciava CGI depois da vegetação: nenhum canto
  // escurecia. Encontro de parede com teto, vão embaixo do sofá, junta
  // entre bancada e armário — tudo recebia exatamente a mesma luz de
  // preenchimento da face aberta. Em foto de arquitetura é justamente
  // esse escurecimento de canto que dá volume ao ambiente.
  //
  // O GTAO resolve em espaço de tela, sem custo de geometria. Fica fora
  // dos tiers baixos porque exige um pré-passe de profundidade/normal.
  // Se a classe não existir na versão do Three.js servida pelo CDN, a
  // experiência segue sem AO em vez de quebrar.
  // ------------------------------------------------------------
  if ((Quality.level === 'ultra' || Quality.level === 'high') && typeof GTAOPass === 'function') {
    try {
      gtaoPass = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
      gtaoPass.output = GTAOPass.OUTPUT.Default;
      // Raio em METROS — a cena está em escala real, então 0,45 m é
      // aproximadamente o vão que se quer escurecer (rodapé, junta,
      // encosto de sofá). Raio grande escureceria ambiente inteiro.
      gtaoPass.updateGtaoMaterial({
        radius: 0.45, distanceExponent: 1.0, thickness: 0.35,
        scale: 1.0, samples: Quality.level === 'ultra' ? 16 : 8,
        screenSpaceRadius: false,
      });
      gtaoPass.blendIntensity = 0.85;
      c.addPass(gtaoPass);
    } catch (e) {
      gtaoPass = null;
      if (DEBUG) console.warn('GTAO indisponível, seguindo sem AO:', e);
    }
  }
  // Bloom só no tier mais alto: é o único passe que depende de WebGL 2.
  // Vinheta, grain e color grade são shaders WebGL 1 simples e rodam em
  // qualquer lugar.
  if (Quality.level === 'ultra') {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.35, 0.86);
    c.addPass(bloomPass);
  }
  gradePass = new ShaderPass(ColorGradeShader);
  c.addPass(gradePass);
  c.addPass(new ShaderPass(VignetteShader));
  grainPass = new ShaderPass(FilmGrainShader);
  if (Capability.reducedMotion) grainPass.enabled = false;
  c.addPass(grainPass);
  return c;
}

// O grade e o bloom acompanham a hora do dia: dia neutro e claro,
// noite mais fria, contrastada e com as luminárias respirando.
function updateGradeForSolarTime(t) {
  if (gradePass) {
    gradePass.uniforms.saturation.value = 1.06 + t * 0.10;
    gradePass.uniforms.contrast.value  = 1.04 + t * 0.10;
    gradePass.uniforms.warmth.value    = 0.35 - t * 0.75;
    gradePass.uniforms.lift.value      = 0.010 + t * 0.030;
  }
  if (grainPass) grainPass.uniforms.amount.value = 0.014 + t * 0.024;
  if (bloomPass) bloomPass.strength = 0.20 + t * 0.55;
}

// ============================================================
// TEXTURAS PROCEDURAIS
// Geradas via canvas, 100% originais — não são derivadas de nenhuma
// imagem externa. Dão variação visual (veios de madeira, veios de pedra)
// sem depender de arquivos de textura.
// ============================================================
function makeCanvasTexture(size, draw, rotulo) {
  const t0 = performance.now();
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Toda textura procedural passa por aqui. Somando o tempo num lugar só,
  // "o boot demora" vira "a geração de textura custa N ms de main thread",
  // que é uma afirmação sobre a qual dá para decidir.
  const dt = performance.now() - t0;
  Perf.texturasMs += dt;
  Perf.texturasN++;
  Perf.porTextura.push([(rotulo || 'canvas') + size, +dt.toFixed(1)]);
  return tex;
}

// ------------------------------------------------------------
// DESENHO QUE ATRAVESSA A BORDA DO LADRILHO
//
// ACHADO RENDERIZANDO o gramado em ângulo rasante: o terreno inteiro era
// uma grade regular de quadrados. Não era filtragem — anisotropia 8 de um
// máximo de 16, mipmap linear. Era o desenho da textura.
//
// grassTexture() espalhava 26 manchas radiais e 2600 lâminas em posições
// aleatórias e desenhava cada uma UMA VEZ. Toda mancha e toda lâmina que
// cai perto da borda é cortada ali. Ladrilhada 450 vezes, a textura vira
// uma grade 450x450 de descontinuidades — e a grade é justamente o que o
// olho acha primeiro num plano grande.
//
// Isto redesenha o elemento no vizinho de além-borda, de modo que o que
// sai de um lado entra pelo outro. No máximo 4 desenhos por elemento (não
// 9): só os vizinhos que o elemento de fato alcança.
function wrapDraw(ctx, s, x, y, raio, desenha) {
  const dxs = [0], dys = [0];
  if (x < raio) dxs.push(s); else if (x > s - raio) dxs.push(-s);
  if (y < raio) dys.push(s); else if (y > s - raio) dys.push(-s);
  for (let i = 0; i < dxs.length; i++) {
    for (let j = 0; j < dys.length; j++) {
      if (dxs[i] === 0 && dys[j] === 0) { desenha(); continue; }
      ctx.save(); ctx.translate(dxs[i], dys[j]); desenha(); ctx.restore();
    }
  }
}

// ============================================================
// PBR DERIVADO DE CAMPO DE ALTURA
// ------------------------------------------------------------
// O QUE ESTAVA ERRADO: cada mapa era DESENHADO separadamente. A cor vinha
// de um conjunto de traços no canvas, o normal de um ruído independente,
// a rugosidade de um cinza com listras. Três imagens que não descrevem a
// mesma superfície — e o olho percebe: o relevo não bate com a mancha, o
// brilho não acompanha a reentrância. É por isso que material procedural
// costuma ler como "textura aplicada" em vez de superfície.
//
// Num fluxo PBR de verdade todos os mapas saem da MESMA geometria de
// microrrelevo. Aqui é isso: um campo de altura em N oitavas, e dele
// derivam:
//   normal    — gradiente do campo (Sobel)
//   AO        — cavidade, isto é, o quanto o ponto está abaixo da média
//               da vizinhança; fundo de junta escurece, saliência não
//   roughness — cavidade rugosa, saliência polida (é onde o pano passa)
//   albedo    — modulado pela mesma cavidade, mais escuro no fundo
//
// Custo: alguns milissegundos de CPU por material no carregamento, e
// ZERO bytes de download — que é o que importa num arquivo único.
// ============================================================

// Ruído de valor com wrap (a textura precisa ladrilhar sem costura).
function _valueNoiseTile(size, freq, seed) {
  const g = new Float32Array(freq * freq);
  let x = seed * 9301 + 49297;
  for (let i = 0; i < g.length; i++) {
    x = (x * 9301 + 49297) % 233280;
    g[i] = x / 233280;
  }
  const out = new Float32Array(size * size);
  const step = freq / size;
  for (let y = 0; y < size; y++) {
    const fy = y * step, y0 = Math.floor(fy) % freq, y1 = (y0 + 1) % freq;
    const ty = fy - Math.floor(fy), sy = ty * ty * (3 - 2 * ty);
    for (let i = 0; i < size; i++) {
      const fx = i * step, x0 = Math.floor(fx) % freq, x1 = (x0 + 1) % freq;
      const tx = fx - Math.floor(fx), sx = tx * tx * (3 - 2 * tx);
      const a = g[y0 * freq + x0], b = g[y0 * freq + x1];
      const c = g[y1 * freq + x0], d = g[y1 * freq + x1];
      const top = a + (b - a) * sx, bot = c + (d - c) * sx;
      out[y * size + i] = top + (bot - top) * sy;
    }
  }
  return out;
}

// Campo de altura em oitavas, normalizado em 0..1.
function heightField(size, opts) {
  opts = opts || {};
  const oct = opts.octaves || 4;
  const base = opts.baseFreq || 4;
  const pers = opts.persistence === undefined ? 0.5 : opts.persistence;
  const seed = opts.seed || 1;
  const h = new Float32Array(size * size);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const freq = Math.max(2, Math.round(base * Math.pow(2, o)));
    const n = _valueNoiseTile(size, freq, seed + o * 17);
    for (let i = 0; i < h.length; i++) h[i] += n[i] * amp;
    norm += amp;
    amp *= pers;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < h.length; i++) { h[i] /= norm; if (h[i] < mn) mn = h[i]; if (h[i] > mx) mx = h[i]; }
  const inv = 1 / Math.max(1e-6, mx - mn);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - mn) * inv;
  return h;
}

// Cavidade: quanto o ponto está ABAIXO da média da vizinhança.
// Positivo = reentrância (escurece e enrugece), negativo = saliência.
function cavityField(h, size, raio) {
  const r = raio || 3;
  const blur = new Float32Array(size * size);
  const tmp = new Float32Array(size * size);
  const n = 2 * r + 1;
  for (let y = 0; y < size; y++) {           // horizontal
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += h[y * size + ((x + k + size) % size)];
      tmp[y * size + x] = acc / n;
    }
  }
  for (let x = 0; x < size; x++) {           // vertical
    for (let y = 0; y < size; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[((y + k + size) % size) * size + x];
      blur[y * size + x] = acc / n;
    }
  }
  const cav = new Float32Array(size * size);
  for (let i = 0; i < cav.length; i++) cav[i] = blur[i] - h[i];
  return cav;
}

// Escava juntas de alvenaria NO CAMPO DE ALTURA, para que normal, AO e
// rugosidade sigam junto — junta que existe só na cor lê como adesivo.
// Fiadas de altura variável, juntas verticais desencontradas entre
// fiadas: é o desencontro que faz o olho ler pedra assentada, e não
// grade. Determinístico por `seed`, então ladrilha sem costura.
function carveCourses(h, size, opts) {
  opts = opts || {};
  const fiadas = opts.courses || 7;
  const prof = opts.depth === undefined ? 0.55 : opts.depth;
  const juntaPx = Math.max(1, Math.round(size * (opts.jointWidth || 0.006)));
  let seed = opts.seed || 5;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  // limites das fiadas com altura variável, fechando exatamente em size
  const bordas = [0];
  const pesos = [];
  for (let i = 0; i < fiadas; i++) pesos.push(0.7 + rnd() * 0.6);
  const soma = pesos.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < fiadas; i++) {
    acc += pesos[i] / soma;
    bordas.push(Math.round(acc * size));
  }

  const cav = (i) => { h[i] = Math.max(0, h[i] - prof); };

  // Tom por BLOCO. Sem isto a parede lê como uma textura de pedra
  // repetida; pedra assentada de verdade tem cada peça vindo de um ponto
  // diferente da pedreira, e é essa variação bloco a bloco que o olho usa
  // para reconhecer alvenaria em vez de padrão.
  const tom = new Float32Array(size * size);

  for (let f = 0; f < fiadas; f++) {
    const y0 = bordas[f], y1 = bordas[f + 1];
    // 1 a 2 peças por fiada: painel de grande formato, não bloco
    const nBlocos = 1 + Math.floor(rnd() * 2);
    const off = rnd();
    // limites verticais dos blocos desta fiada
    const cortes = [];
    for (let b = 0; b < nBlocos; b++) cortes.push(Math.round(((b + off) / nBlocos) * size) % size);
    cortes.sort((a, b) => a - b);
    const tons = cortes.map(() => rnd());

    // pinta o tom de cada bloco na faixa da fiada
    for (let y = y0; y < y1; y++) {
      const yy = y % size;
      for (let x = 0; x < size; x++) {
        let idx = 0;
        for (let b = 0; b < cortes.length; b++) if (x >= cortes[b]) idx = b;
        tom[yy * size + x] = tons[idx];
      }
    }

    // junta horizontal no topo da fiada
    for (let d = 0; d < juntaPx; d++) {
      const y = (y0 + d) % size;
      for (let x = 0; x < size; x++) cav(y * size + x);
    }
    // juntas verticais
    for (const xc of cortes) {
      for (let d = 0; d < juntaPx; d++) {
        const x = (xc + d) % size;
        for (let y = y0 + juntaPx; y < y1; y++) cav((y % size) * size + x);
      }
    }
  }
  return tom;
}

// Escava juntas de TÁBUA no campo de altura. Mesma lógica das fiadas de
// pedra: junta que existe só na cor lê como adesivo, porque o relevo e a
// sombra não a acompanham. Devolve o tom por tábua — piso de madeira real
// tem cada peça de uma parte diferente da tora, e é essa variação que
// impede o piso de ler como papel de parede.
function carvePlanks(h, size, opts) {
  opts = opts || {};
  const nTab = opts.planks || 6;
  const prof = opts.depth === undefined ? 0.4 : opts.depth;
  const juntaPx = Math.max(1, Math.round(size * (opts.jointWidth || 0.004)));
  let seed = opts.seed || 3;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  const tom = new Float32Array(size * size);
  const larg = size / nTab;

  for (let t = 0; t < nTab; t++) {
    const x0 = Math.round(t * larg);
    const x1 = Math.round((t + 1) * larg);
    // topo de tábua (junta de topo) numa posição própria de cada peça
    const topo = Math.round(rnd() * size);
    const tomA = rnd(), tomB = rnd();

    for (let x = x0; x < x1; x++) {
      for (let y = 0; y < size; y++) {
        // as duas metades da tábua (antes e depois do topo) têm tons próprios
        const dist = (y - topo + size) % size;
        tom[y * size + x] = dist < size / 2 ? tomA : tomB;
      }
    }
    // junta longitudinal na borda da tábua
    for (let d = 0; d < juntaPx; d++) {
      const x = (x0 + d) % size;
      for (let y = 0; y < size; y++) h[y * size + x] = Math.max(0, h[y * size + x] - prof);
    }
    // junta de topo
    for (let d = 0; d < juntaPx; d++) {
      const y = (topo + d) % size;
      for (let x = x0; x < x1; x++) h[y * size + x] = Math.max(0, h[y * size + x] - prof);
    }
  }
  return tom;
}

function _texFromData(size, data, srgb, repeat) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat, repeat);
  return t;
}

// Monta o conjunto PBR completo a partir de um campo de altura.
// `cor(alt, cav, x, y)` devolve [r,g,b] em 0..255 — é onde cada material
// põe sua identidade (veio de pedra, poro de reboco, fibra de madeira).
function pbrFromHeight(size, h, cor, opts) {
  const _t0 = performance.now();
  Perf.texturasN += 4;   // albedo + normal + roughness + ao
  try {
  return _pbrFromHeight(size, h, cor, opts);
  } finally {
    const dt = performance.now() - _t0;
    Perf.texturasMs += dt;
    Perf.porTextura.push(['pbr' + size, +dt.toFixed(1)]);
  }
}
function _pbrFromHeight(size, h, cor, opts) {
  opts = opts || {};
  const forcaNormal = opts.normalStrength === undefined ? 2.0 : opts.normalStrength;
  const cav = cavityField(h, size, opts.cavityRadius || 3);
  // BUG CORRIGIDO — cavidade normalizada pelo próprio máximo.
  // A versão anterior fazia cv = cav/max(|cav|). Num campo LISO (reboco
  // fino, 3 oitavas de frequência baixa) a cavidade real é minúscula, e
  // dividir pelo próprio máximo amplificava o piso de ruído numérico até
  // a escala cheia: as paredes de estuque saíram manchadas, com aspecto
  // de encardido. Normalização relativa transforma "quase nada" em
  // "tudo".
  // Agora o ganho é FIXO por material: campo liso produz cavidade fraca,
  // que é o correto.
  const cavGain = opts.cavityGain === undefined ? 9 : opts.cavityGain;

  const alb = new Uint8ClampedArray(size * size * 4);
  const nrm = new Uint8ClampedArray(size * size * 4);
  const rgh = new Uint8ClampedArray(size * size * 4);
  const aoo = new Uint8ClampedArray(size * size * 4);

  const rBase = opts.roughBase === undefined ? 0.82 : opts.roughBase;
  const rVar = opts.roughVar === undefined ? 0.28 : opts.roughVar;
  const aoForca = opts.aoStrength === undefined ? 0.75 : opts.aoStrength;
  const albCav = opts.albedoCavity === undefined ? 0.30 : opts.albedoCavity;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, j = i * 4;
      const cv = Math.max(-1, Math.min(1, cav[i] * cavGain));
      const cvPos = Math.max(0, cv);               // só reentrância

      const rgb = cor(h[i], cv, x, y, size);
      const k = 1 - cvPos * albCav;                // fundo de junta escurece
      alb[j] = rgb[0] * k; alb[j+1] = rgb[1] * k; alb[j+2] = rgb[2] * k; alb[j+3] = 255;

      // normal por Sobel no campo de altura
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * forcaNormal, ny = (u - d) * forcaNormal;
      const len = Math.hypot(nx, ny, 1);
      nrm[j] = ((nx / len) * 0.5 + 0.5) * 255;
      nrm[j+1] = ((ny / len) * 0.5 + 0.5) * 255;
      nrm[j+2] = ((1 / len) * 0.5 + 0.5) * 255;
      nrm[j+3] = 255;

      // rugosidade: reentrância áspera, saliência polida (onde o pano passa)
      const rough = Math.min(1, Math.max(0, rBase + cv * rVar));
      rgh[j] = rgh[j+1] = rgh[j+2] = rough * 255; rgh[j+3] = 255;

      // AO de cavidade
      const ao = 1 - cvPos * aoForca;
      aoo[j] = aoo[j+1] = aoo[j+2] = ao * 255; aoo[j+3] = 255;
    }
  }
  return {
    map: _texFromData(size, alb, true, opts.repeat),
    normalMap: _texFromData(size, nrm, false, opts.repeat),
    roughnessMap: _texFromData(size, rgh, false, opts.repeat),
    aoMap: _texFromData(size, aoo, false, opts.repeat),
  };
}

// Aplica um conjunto PBR num material, preservando a intenção autoral do
// normalScale e mantendo `roughness` em 1 (quem manda passa a ser o mapa,
// que já traz o valor absoluto — multiplicar de novo achataria tudo).
function applyPBR(material, maps, normalScale) {
  // Os materiais são construídos com texturas procedurais que aqui são
  // SUBSTITUÍDAS. Sem descartar as antigas elas ficam alocadas na GPU
  // sem nenhuma referência que as use — vazamento silencioso, e ainda
  // aparecendo na contagem de renderer.info.memory.textures.
  [material.map, material.normalMap, material.roughnessMap, material.aoMap]
    .forEach(t => { if (t && t.dispose && !Object.values(maps).includes(t)) t.dispose(); });
  material.map = maps.map;
  material.normalMap = maps.normalMap;
  material.normalScale = new THREE.Vector2(normalScale, normalScale);
  material.roughnessMap = maps.roughnessMap;
  material.aoMap = maps.aoMap;
  material.roughness = 1.0;
  material.needsUpdate = true;
  return material;
}

function woodGrainTexture(baseHex, streakHex, repeatX, repeatY, opts) {
  opts = opts || {};
  const size = opts.highRes ? 512 : 256;
  const tex = makeCanvasTexture(size, (ctx, s) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, s, s);
    // tábuas com variação de tom entre si
    const nPlanks = opts.planks || 4;
    const plankW = s / nPlanks;
    for (let p = 0; p < nPlanks; p++) {
      ctx.fillStyle = shadeHex(baseHex, 1 + (Math.random() - 0.5) * 0.08);
      ctx.fillRect(p * plankW, 0, plankW - 1, s);
    }
    // veio principal
    for (let i = 0; i < 28; i++) {
      const y = Math.random() * s, h = 1 + Math.random() * 2.5;
      ctx.globalAlpha = 0.04 + Math.random() * 0.10;
      ctx.fillStyle = streakHex;
      ctx.fillRect(0, y, s, h);
    }
    // nós da madeira
    for (let i = 0; i < 3; i++) {
      const nx = Math.random() * s, ny = Math.random() * s, nr = 8 + Math.random() * 18;
      ctx.globalAlpha = 0.06 + Math.random() * 0.08;
      ctx.fillStyle = streakHex;
      ctx.beginPath();
      ctx.ellipse(nx, ny, nr, nr * (0.4 + Math.random() * 0.4), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // grão fino
    for (let i = 0; i < 80; i++) {
      const y = Math.random() * s, h = 0.5 + Math.random();
      ctx.globalAlpha = 0.02 + Math.random() * 0.04;
      ctx.fillStyle = streakHex;
      ctx.fillRect(0, y, s, h);
    }
    ctx.globalAlpha = 1;
  }, 'madeira');
  // ------------------------------------------------------------
  // BUG CORRIGIDO — o deck de ipê refletia o céu como espelho
  // Localizado por raycast: a chapa branca no primeiro plano da câmera
  // da piscina era o DECK, não a água.
  //
  // Causa: makeCanvasTexture() marca a textura como sRGB, o que está
  // certo para mapa de COR e errado para mapa de RUGOSIDADE. Um mapa
  // cinza #888 (0,533) convertido de sRGB para linear vira 0,247, e o
  // Three.js MULTIPLICA a rugosidade do material por esse valor: a
  // madeira saía com roughness 0,66 x 0,247 = 0,16 em vez de 0,66.
  // Praticamente verniz espelhado — e em ângulo rasante, por Fresnel,
  // isso reflete o céu quase por inteiro. Daí a chapa branca.
  //
  // Mapas de dado (rugosidade, metalicidade, normal, AO) são NUMEROS,
  // não cor: têm de ser lidos em espaço linear.
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

// Rugosidade não uniforme: o veio é mais liso que o fundo e os nós são
// mais ásperos. É o que faz a madeira reagir à luz como madeira em vez
// de como plástico colorido.
function woodRoughnessMap(repeatX, repeatY, highRes) {
  const size = highRes ? 512 : 256;
  const tex = makeCanvasTexture(size, (ctx, s) => {
    // A base era #888. Como o Three.js MULTIPLICA a rugosidade do
    // material pelo mapa, cinza-médio corta a rugosidade pela metade —
    // a madeira nunca chegava perto do valor autoral. Num mapa de
    // rugosidade, branco = rugosidade cheia; o mapa serve para tirar
    // brilho onde a superfície é mais lisa, não para dividir tudo.
    // MEDIDO: com o mapa em #888, a região do deck saía com 5,45% de
    // pixels estourados refletindo o céu.
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const y = Math.random() * s, h = 1 + Math.random() * 2.5;
      ctx.globalAlpha = 0.08 + Math.random() * 0.12;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, y, s, h);
    }
    // nós da madeira: pontos mais lisos, e só eles
    for (let i = 0; i < 3; i++) {
      const nx = Math.random() * s, ny = Math.random() * s, nr = 8 + Math.random() * 18;
      ctx.globalAlpha = 0.16; ctx.fillStyle = '#9a9a9a';
      ctx.beginPath();
      ctx.ellipse(nx, ny, nr, nr * (0.4 + Math.random() * 0.4), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

function stoneVeinTexture(baseHex, veinHex, opts) {
  opts = opts || {};
  // REESCRITA. A versão anterior desenhava 5 veios grossos e 12 finos
  // percorrendo o ladrilho de cima a baixo com deslocamento lateral de
  // até 50 px por passo. Com a UV em escala real (um ladrilho = 1,6 m),
  // isso aparecia como meia dúzia de fios verticais errantes atravessando
  // a fachada inteira — foi o artefato localizado por raycast no portal
  // de entrada. Pedra real não tem isso: tem grão fino, manchas de tom e
  // veios com direção de LEITO, predominantemente horizontal.
  const S = opts.highRes ? 512 : 256;
  const tex = makeCanvasTexture(S, (ctx, s) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, s, s);

    // 1. manchas de tom. AJUSTADO depois de renderizar: com raio de até
    // 0,26 do ladrilho e alfa 0,16, num ladrilho de 1,6 m elas viravam
    // borrões de 40 cm — leitura de camuflagem, não de pedra. Manchas
    // pequenas e fracas dão variação sem virar desenho.
    for (let i = 0; i < 52; i++) {
      const cx = Math.random() * s, cy = Math.random() * s;
      const r = s * (0.03 + Math.random() * 0.09);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, shadeHex(Math.random() < 0.5 ? baseHex : veinHex, 0.9 + Math.random() * 0.22));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    // 2. grão fino — o que dá leitura de pedra de perto
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 16;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);

    // 3. veios com direção de leito: quase horizontais, muitos e sutis,
    // com jitter pequeno. É o oposto do "fio errante" anterior.
    const veios = opts.veins === undefined ? 26 : opts.veins;
    const inclina = opts.bedding === undefined ? 0.16 : opts.bedding;
    ctx.lineCap = 'round';
    for (let i = 0; i < veios; i++) {
      const grosso = Math.random() < 0.28;
      ctx.globalAlpha = grosso ? 0.13 : 0.07;
      ctx.strokeStyle = veinHex;
      ctx.lineWidth = grosso ? (1.2 + Math.random() * 2.0) * (S / 256) : (0.4 + Math.random() * 0.7) * (S / 256);
      let y = Math.random() * s;
      let x = -s * 0.05;
      ctx.beginPath();
      ctx.moveTo(x, y);
      while (x < s * 1.05) {
        x += s * (0.06 + Math.random() * 0.10);
        y += (Math.random() - 0.5) * s * inclina;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, 'pedra');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // repeat 1: a escala agora vem da UV em metros (applyWorldUV/TILE_M)
  tex.repeat.set(1, 1);
  return tex;
}

function rugPatternTexture(baseHex, accentHex) {
  const tex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = accentHex;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, s - 28, s - 28);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.25;
    ctx.strokeRect(28, 28, s - 56, s - 56);
    ctx.globalAlpha = 1;
  }, 'tapete');
  return tex;
}

function paverTexture(baseHex, jointHex, tilesPerSide) {
  const tex = makeCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = jointHex;
    ctx.fillRect(0, 0, s, s);
    const cell = s / tilesPerSide;
    const gap = Math.max(2, cell * 0.045);
    for (let ty = 0; ty < tilesPerSide; ty++) {
      for (let tx = 0; tx < tilesPerSide; tx++) {
        const shade = 1 + (Math.random() - 0.5) * 0.09;
        const c = shadeHex(baseHex, shade);
        ctx.fillStyle = c;
        ctx.fillRect(tx * cell + gap, ty * cell + gap, cell - gap * 2, cell - gap * 2);
      }
    }
  }, 'paverTexture');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function shadeHex(hex, factor) {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * factor); c.g = Math.min(1, c.g * factor); c.b = Math.min(1, c.b * factor);
  return '#' + c.getHexString();
}

function gravelTexture(baseHex) {
  const tex = makeCanvasTexture(128, (ctx, s) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 1 + Math.random() * 2;
      ctx.fillStyle = shadeHex(baseHex, 0.75 + Math.random() * 0.5);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }, 'gravelTexture');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ============================================================
// VEGETAÇÃO — CARTÕES DE FOLHAGEM
// ------------------------------------------------------------
// O maior denunciador de CGI da cena era a copa: um cone (ou icosaedro)
// de cor chapada. Nenhuma árvore real tem silhueta poliédrica fechada —
// copa de verdade tem borda recortada, furos por onde o céu aparece e
// luz atravessando a folha.
//
// A técnica de archviz em tempo real para isso é o CARTÃO DE FOLHAGEM:
// um quad com textura recortada em alpha. Vários cartões em orientações
// aleatórias formam a copa. O custo continua sendo 1 draw call por
// grupo, porque todos compartilham geometria e material — o que muda é
// só o número de instâncias.
// ============================================================

// Desenha uma folha lanceolada apontando para +x, com nervura central.
function _drawLeaf(ctx, len, wid, fill, vein) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.42, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.42, wid, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill();
  if (vein) {
    ctx.beginPath();
    ctx.moveTo(len * 0.06, 0);
    ctx.lineTo(len * 0.92, 0);
    ctx.strokeStyle = vein;
    ctx.lineWidth = Math.max(0.6, wid * 0.13);
    ctx.stroke();
  }
}

// Um cartão = um tufo de folhas com fundo transparente. A densidade cai
// para a borda, então a silhueta sai recortada em vez de circular.
function leafCardTexture(baseHex, opts) {
  opts = opts || {};
  const S = opts.size || 256;
  const count = opts.count || 130;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const cx = S / 2, cy = S / 2;
  const R = S * 0.46;

  for (let i = 0; i < count; i++) {
    // raiz quadrada da uniforme concentra folhas no miolo e rarefaz a
    // borda — é isso que dá o recorte irregular contra o céu
    const rr = Math.sqrt(Math.random()) * R;
    const a = Math.random() * Math.PI * 2;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    // folhas do fundo mais escuras: profundidade dentro da própria copa
    const depth = 0.55 + (1 - rr / R) * 0.15 + Math.random() * 0.45;
    const len = S * (0.085 + Math.random() * 0.075) * (opts.leafScale || 1);
    const wid = len * (opts.narrow ? 0.16 : 0.30);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI * 2);
    _drawLeaf(ctx, len, wid, shadeHex(baseHex, depth), shadeHex(baseHex, depth * 0.72));
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Cartão de touceira: as lâminas nascem da BORDA DE BAIXO e se abrem em
// leque. Reaproveitar o cartão de copa aqui dava tufos "espalhados no
// ar" — grama real sai do chão num ponto só.
function grassBladeCardTexture(baseHex) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  const blades = 46;
  for (let i = 0; i < blades; i++) {
    const x0 = S * (0.5 + (Math.random() - 0.5) * 0.42);
    const h = S * (0.45 + Math.random() * 0.5);
    const bend = (Math.random() - 0.5) * S * 0.42;
    const w = S * (0.008 + Math.random() * 0.014);
    const shade = 0.55 + Math.random() * 0.7;
    ctx.strokeStyle = shadeHex(baseHex, shade);
    ctx.lineWidth = w * 2;
    ctx.beginPath();
    ctx.moveTo(x0, S);
    // curva com a ponta caindo: lâmina reta lê como escova
    ctx.bezierCurveTo(x0 + bend * 0.2, S - h * 0.45, x0 + bend * 0.7, S - h * 0.85, x0 + bend, S - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Casca com estrias verticais — o tronco de cor chapada lia como cano.
function barkTexture(baseHex) {
  const tex = makeCanvasTexture(128, (ctx, s) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * s;
      const w = 1 + Math.random() * 3;
      ctx.fillStyle = shadeHex(baseHex, 0.62 + Math.random() * 0.62);
      ctx.globalAlpha = 0.5 + Math.random() * 0.5;
      // estria quebrada, não linha contínua: casca não é listrada
      let y = 0;
      while (y < s) {
        const h = 6 + Math.random() * 26;
        ctx.fillRect(x + (Math.random() - 0.5) * 2, y, w, h);
        y += h + Math.random() * 5;
      }
    }
    ctx.globalAlpha = 1;
  }, 'casca');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ============================================================
// GRAMA — a textura anterior era gravelTexture() esticada
// ------------------------------------------------------------
// MEDIDO no render: gravelTexture(128px) com repeat 34 sobre um plano de
// 260 m dá 7,6 m por ladrilho. Perto da câmera não há detalhe nenhum
// (cada pixel da textura cobre ~6 cm) e longe o padrão se repete visível.
// Resultado: o "tapete verde" lavado.
//
// Aqui a textura é de grama de verdade — lâminas curtas em várias
// direções, com variação de tom — e a repetição fica pequena o
// suficiente para ter detalhe perto. O tiling que isso criaria é
// quebrado depois por applyMacroVariation().
// ============================================================
// `opts` existe para a bancada (`gramado-lab`) poder varrer a escala das
// manchas sem duplicar a função. Os padrões são exatamente o que a cena
// sempre usou, então chamar `grassTexture(cor)` continua idêntico.
function grassTexture(baseHex, opts) {
  opts = opts || {};
  const nManchas = opts.manchas === undefined ? 26 : opts.manchas;
  const rMin = opts.manchaMin === undefined ? 0.15 : opts.manchaMin;
  const rVar = opts.manchaVar === undefined ? 0.30 : opts.manchaVar;
  const tex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = shadeHex(baseHex, 0.82);
    ctx.fillRect(0, 0, s, s);
    // manchas largas de tom antes das lâminas: gramado real tem áreas
    // mais secas e mais verdes, nunca cor única
    for (let i = 0; i < nManchas; i++) {
      const cx = Math.random() * s, cy = Math.random() * s;
      const r = s * (rMin + Math.random() * rVar);
      // deslocamento pequeno entre os dois focos: dá à mancha um caimento
      // assimétrico, mais parecido com área seca de gramado que um disco
      const ox = (Math.random() - 0.5) * r * 0.5, oy = (Math.random() - 0.5) * r * 0.5;
      const tone = shadeHex(baseHex, 0.78 + Math.random() * 0.5);
      wrapDraw(ctx, s, cx, cy, r, () => {
        const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx, cy, r);
        g.addColorStop(0, tone); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      });
    }
    // lâminas
    ctx.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.7;
      const len = 3 + Math.random() * 7;
      const cor = shadeHex(baseHex, 0.6 + Math.random() * 0.75);
      const w = 0.7 + Math.random() * 1.1;
      wrapDraw(ctx, s, x, y, len + 2, () => {
        ctx.strokeStyle = cor;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(
          x + Math.cos(a) * len * 0.5 + 1.5, y + Math.sin(a) * len * 0.5,
          x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      });
    }
  }, 'grama');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Normal map derivado de ruído — dá relevo à grama e ao cascalho, que
// sem normal recebem luz como um plano liso e por isso "lavam".
function noiseNormalTexture(scale, strength) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const h = new Float32Array(S * S);
  // ruído de valor em 3 oitavas, com wrap para a textura ladrilhar
  for (let o = 0; o < 3; o++) {
    const freq = scale * Math.pow(2, o);
    const amp = 1 / Math.pow(2, o);
    const grid = [];
    for (let i = 0; i < freq * freq; i++) grid.push(Math.random());
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * freq, fy = (y / S) * freq;
        const x0 = Math.floor(fx) % freq, y0 = Math.floor(fy) % freq;
        const x1 = (x0 + 1) % freq, y1 = (y0 + 1) % freq;
        const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = grid[y0 * freq + x0], b = grid[y0 * freq + x1];
        const cc = grid[y1 * freq + x0], d = grid[y1 * freq + x1];
        h[y * S + x] += amp * ((a + (b - a) * sx) + ((cc + (d - cc) * sx) - (a + (b - a) * sx)) * sy);
      }
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = h[y * S + ((x - 1 + S) % S)], r = h[y * S + ((x + 1) % S)];
      const u = h[((y - 1 + S) % S) * S + x], d = h[((y + 1) % S) * S + x];
      const nx = (l - r) * strength, ny = (u - d) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;   // mapa de dado, não de cor
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ============================================================
// QUEBRA DE TILING POR VARIAÇÃO MACRO
// ------------------------------------------------------------
// Repetir uma textura o suficiente para ter detalhe perto cria padrão
// visível longe. A solução padrão de terreno é modular a cor difusa por
// um ruído de escala grande em espaço de mundo: o olho perde a grade
// porque a variação macro não coincide com o período do ladrilho.
// Custo: algumas instruções por fragmento, sem textura extra.
// ============================================================
// ============================================================
// LUZ DE FACHADA (uplight) — sem custo de luz real
// ------------------------------------------------------------
// ENCONTRADO renderizando a "Visão Final": à noite a arquitetura só se
// lia como silhueta. Faltava o que toda casa de alto padrão tem à
// noite — balizadores lavando as paredes de baixo para cima. É isso que
// dá relevo à fachada depois que o sol some.
//
// O caminho óbvio seria PointLight ou SpotLight, mas não cabe: o
// MeshStandardMaterial avalia TODAS as luzes por fragmento, e o
// orçamento é de 4 a 6 luzes reais no projeto inteiro (LIGHT_BUDGET).
// Gastar metade dele em fachada seria trocar a luz dos ambientes por
// luz de parede.
//
// Aqui a lavagem é calculada direto no material: para cada ponto de
// luminária, um decaimento radial em XZ e um decaimento vertical a
// partir da base. Custa algumas instruções por fragmento em DOIS
// materiais, não uma luz na cena inteira, e não entra no orçamento.
// A intensidade acompanha a mesma rampa das luminárias internas.
// ============================================================
// ============================================================
// CHAVE DE PROGRAMA POR MATERIAL — bug encontrado renderizando
// ------------------------------------------------------------
// O Three.js monta a chave de cache do programa incluindo
// `material.onBeforeCompile.toString()`. Como applyMacroVariation() e
// applyUplightWash() instalam SEMPRE a mesma função (fecham sobre
// parâmetros diferentes, mas o texto da função é idêntico), materiais
// distintos caíam na MESMA chave e passavam a compartilhar um programa.
//
// Com uniforms escalares isso passa despercebido: o material herda a
// escala de ruído do vizinho. Com ARRAY é fatal — o programa declarava
// uWashSpots[8] (estuque) e recebia os 2 pontos do núcleo de pedra, e o
// upload estourava em "Cannot read properties of undefined (reading
// 'toArray')", derrubando o pós-processamento junto.
//
// Cada material passa a ter chave própria, o que também corrige o caso
// silencioso: gramado, cascalho, estuque, pedra e travertino tinham
// variação macro com parâmetros distintos e podiam estar todos rodando
// o programa do primeiro a compilar.
// ============================================================
let _auraKeySeq = 0;
function ensureOwnProgramKey(material) {
  if (!material.userData.__auraProgKey) {
    material.userData.__auraProgKey = 'aura' + (++_auraKeySeq);
  }
  const k = material.userData.__auraProgKey;
  material.customProgramCacheKey = () => k;
}

const uplightUniform = { value: 0 };

function applyUplightWash(material, spots, alcance, altura, prevHook) {
  if (!spots || !spots.length) return;
  ensureOwnProgramKey(material);
  const n = spots.length;
  const pontos = spots.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const prev = prevHook || material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uWash = uplightUniform;
    shader.uniforms.uWashSpots = { value: pontos };
    shader.uniforms.uWashR = { value: alcance };
    shader.uniforms.uWashH = { value: altura };
    shader.vertexShader = 'varying vec3 vWashWPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vWashWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = [
      'uniform float uWash;',
      'uniform float uWashR;',
      'uniform float uWashH;',
      'uniform vec3 uWashSpots[' + n + '];',
      'varying vec3 vWashWPos;',
    ].join('\n') + '\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      [
        '#include <emissivemap_fragment>',
        'if (uWash > 0.001) {',
        '  float w = 0.0;',
        '  for (int i = 0; i < ' + n + '; i++) {',
        '    vec3 sp = uWashSpots[i];',
        '    float d = distance(vWashWPos.xz, sp.xz);',
        '    float radial = 1.0 - smoothstep(0.0, uWashR, d);',
        // decaimento vertical ao quadrado: forte no rodapé, some na verga
        '    float h = clamp((vWashWPos.y - sp.y) / uWashH, 0.0, 1.0);',
        '    float vert = (1.0 - h) * (1.0 - h);',
        '    w += radial * vert;',
        '  }',
        '  totalEmissiveRadiance += vec3(1.0, 0.82, 0.60) * min(w, 1.5) * uWash;',
        '}',
      ].join('\n'));
  };
  material.needsUpdate = true;
}

function applyMacroVariation(material, scale, strength, prevHook) {
  ensureOwnProgramKey(material);
  const prev = prevHook || material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uMacroScale = { value: scale };
    shader.uniforms.uMacroStrength = { value: strength };
    shader.vertexShader = 'varying vec3 vMacroWPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vMacroWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = [
      'uniform float uMacroScale;',
      'uniform float uMacroStrength;',
      'varying vec3 vMacroWPos;',
      'float auraHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float auraNoise(vec2 p){',
      '  vec2 i = floor(p), f = fract(p);',
      '  vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(auraHash(i), auraHash(i + vec2(1.0, 0.0)), u.x),',
      '             mix(auraHash(i + vec2(0.0, 1.0)), auraHash(i + vec2(1.0, 1.0)), u.x), u.y);',
      '}',
    ].join('\n') + '\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      [
        '#include <color_fragment>',
        '{',
        // ACHADO RENDERIZANDO: a versão anterior amostrava o ruído em
        // vMacroWPos.XZ. Numa superfície horizontal isso é o certo — foi
        // para o gramado que a função nasceu. Numa PAREDE, porém, x ou z
        // é constante e y não entra na conta: o ruído deixa de variar na
        // vertical e vira faixa contínua de cima a baixo. Nas paredes de
        // estuque isso lia como mancha de infiltração escorrendo.
        //
        // A primeira tentativa de correção — (x + 0,62z, y + 0,37z) —
        // consertou a parede e QUEBROU o chão: no plano horizontal a
        // segunda componente passou a depender só de z, então o ruído
        // parou de variar ao longo de x e o gramado virou um acolchoado
        // diagonal, bem pior que a faixa original.
        //
        // Não basta os três eixos aparecerem: os pesos têm de deixar a
        // matriz 2x2 bem condicionada para QUALQUER par de eixos, senão
        // sempre há um plano onde ela degenera. Com estes pesos os três
        // determinantes são 0,81 (xz), 0,46 (yz) e 0,35 (xy).
        '  vec2 mp = vec2(vMacroWPos.x * 0.90 + vMacroWPos.y * 0.60 + vMacroWPos.z * 0.20,',
        '                 vMacroWPos.x * 0.25 + vMacroWPos.y * 0.55 + vMacroWPos.z * 0.95) / uMacroScale;',
        // duas oitavas incomensuráveis com o período do ladrilho
        '  float n = auraNoise(mp) * 0.62 + auraNoise(mp * 2.73) * 0.38;',
        '  diffuseColor.rgb *= 1.0 + (n - 0.5) * 2.0 * uMacroStrength;',
        '}',
      ].join('\n'));
  };
  material.needsUpdate = true;
}

// ============================================================
// OCLUSÃO DE IBL EM AMBIENTE INTERNO
// ------------------------------------------------------------
// O defeito, medido: numa sala fechada a parede lia 185 e o sofá 45 —
// razão de 4:1 dentro do mesmo cômodo. Desligar scene.environment
// derrubava a parede em 142, ou seja, 77% do brilho dela vinha do IBL.
//
// A causa não é a parede: é que o mapa de ambiente NÃO TEM OCLUSÃO. Cada
// fragmento amostra o hemisfério inteiro do céu, esteja ele na fachada ou
// no fundo de um quarto sem janela. Um teto de gesso a 3 m do chão, dentro
// da casa, recebia a mesma irradiância de céu que a laje da cobertura.
//
// Eu vinha corrigindo isso material a material — primeiro a parede, depois
// o tapete, depois o piso do quarto — e a cada render aparecia a próxima
// superfície com o mesmo sintoma. Era whack-a-mole: a causa é geométrica e
// vale para TODA superfície interna, então a correção tem de ser geométrica.
//
// GTAO resolve contato (centímetros). Isto resolve a escala do cômodo:
// dentro do envelope da casa, a contribuição do céu cai para uma fração,
// voltando a subir perto do vidro — que é por onde o céu de fato entra.
// É o mesmo princípio de um volume de sondas de interior num motor de
// jogo, com o volume escrito à mão em vez de baked.
//
// Os limites ficam no EIXO da parede, não na face: a transição de 10 cm
// cai dentro dos 22 cm de espessura, então a face interna lê 1 e a
// externa lê 0 sem que uma vaze na outra.
// ============================================================
const indoorU = {
  lo: { value: [new THREE.Vector3(-11.1, 0.06, -6.1), new THREE.Vector3(-13.1, 3.58, -4.9)] },
  hi: { value: [new THREE.Vector3(12.1, 3.30, 6.0), new THREE.Vector3(-4.3, 6.58, 4.9)] },
  // plano de vidro de cada volume: é dele que o céu entra de verdade
  glassZ: { value: [6.0, 4.9] },
  // Quanto do céu sobra no fundo do cômodo.
  //
  // 0,16 e não 0,30 porque LP.*.envI subiu junto, e os dois multiplicam.
  // envI valia 0,45 no dia — um freio GLOBAL que existia para segurar a
  // parede interna estourada pelo IBL sem oclusão, e que cobrava o preço
  // do lado de fora: medido no enquadramento geral, a casa lia 78 e o
  // terreno 45 ao meio-dia. Aumentar envI sozinho estourava o interior
  // (recorte de 0,24% para 10,1%); baixar só ele apagava o exterior.
  //
  // A máscara é justamente o instrumento que separa os dois: o produto
  // envI * min é o céu absoluto que chega ao fundo do cômodo, e ele fica
  // constante em 0,136 enquanto envI se move para servir o exterior.
  //
  // envI chegou a 0,85 numa primeira rodada e ESTOUROU as paredes brancas
  // que enxergam céu aberto — na "Chegada", a parede junto à porta media
  // 236 com 27,8% do quadro acima de 250. Desligando fonte por fonte ali,
  // o ambiente respondia por 226 dos 236: aquela parede é quase 100% IBL.
  //
  // O que resolveu não foi escolher entre interior e exterior, foi ver que
  // o exterior nunca precisou de tanto céu — precisava de SOL. Com sunI em
  // 5,0 o terreno já lê 68,5 com envI em 0,45 (lia 45 antes). Então envI
  // voltou para 0,60, as paredes desestouraram, e o terreno ficou onde
  // estava. Céu de meio-dia não é o que ilumina um dia de sol.
  min: { value: 0.130 },
  // ------------------------------------------------------------
  // O QUE ENTRA NO LUGAR DO CÉU
  // Tirar a irradiância do céu e não repor nada deixou toda superfície
  // VOLTADA PARA CIMA no escuro — o edredom da cama, o assento do sofá, o
  // tampo da mesa. Faz sentido: era o hemisfério do céu que iluminava o
  // que aponta para cima, e a máscara o removeu.
  //
  // Só que uma superfície dentro de um quarto não enxerga NADA: ela
  // enxerga parede e teto, que são de estuque claro e madeira quente. É
  // isso que uma sonda de interior guarda num motor de jogo — a radiância
  // do próprio cômodo, não zero. Então a máscara troca céu por rebote
  // quente em vez de subtrair.
  //
  // Só no termo difuso. O especular continua apenas atenuado: rebote de
  // parede é difuso e não produz reflexo nítido.
  bounce: { value: new THREE.Color(0xffe6cc) },
  fill: { value: 0.15 },
  // Teto do termo de janela.
  //
  // A primeira versão devolvia k = 1,0 junto ao vidro, ou seja: céu
  // INTEIRO. Com envI em 0,85 a faixa de piso rente à janela estourou
  // para branco — apareceu no render de perto do vidro.
  //
  // E 1,0 nunca esteve certo: janela é ABERTURA. Uma superfície colada no
  // vidro enxerga, no melhor caso, meio hemisfério — a metade que o vão
  // recorta — e não a abóbada toda. 0,55 é esse limite geométrico, não um
  // número escolhido para a imagem ficar boa.
  winMax: { value: 0.55 },
};

function applyIndoorOcclusion(material, prevHook) {
  if (!material || !material.isMeshStandardMaterial) return;
  if (material.userData.__indoor) return;      // idempotente
  material.userData.__indoor = true;
  // NÃO chama ensureOwnProgramKey aqui, de propósito. Aquela chave existe
  // porque three.js guarda o objeto `shader` junto com o programa: dois
  // materiais que compartilham programa compartilham também as uniforms
  // injetadas, e o segundo renderiza com os valores do primeiro. Isso só
  // é um problema quando as uniforms são POR MATERIAL (vento, variação
  // macro, wash) — e essas funções já pedem chave própria.
  //
  // Aqui todas as uniforms são o mesmo objeto indoorU compartilhado, então
  // compartilhar programa é correto. Forçar chave própria custou caro e foi
  // medido: 81 -> 211 programas compilados só por chamar a função à toa.
  const prev = prevHook || material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    // Uniforms COMPARTILHADOS entre todos os materiais: um único write
    // move a casa inteira, e a varredura de calibração fica barata.
    shader.uniforms.uIndoorLo = indoorU.lo;
    shader.uniforms.uIndoorHi = indoorU.hi;
    shader.uniforms.uIndoorGlassZ = indoorU.glassZ;
    shader.uniforms.uIndoorMin = indoorU.min;
    shader.uniforms.uIndoorBounce = indoorU.bounce;
    shader.uniforms.uIndoorFill = indoorU.fill;
    shader.uniforms.uIndoorWinMax = indoorU.winMax;

    shader.vertexShader = 'varying vec3 vIndoorWPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vIndoorWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = [
      'uniform vec3 uIndoorLo[2];',
      'uniform vec3 uIndoorHi[2];',
      'uniform float uIndoorGlassZ[2];',
      'uniform float uIndoorMin;',
      'uniform vec3 uIndoorBounce;',
      'uniform float uIndoorFill;',
      'uniform float uIndoorWinMax;',
      'varying vec3 vIndoorWPos;',
      'float auraBoxIn(vec3 p, vec3 lo, vec3 hi){',
      '  vec3 s = smoothstep(lo, lo + vec3(0.10), p) * (vec3(1.0) - smoothstep(hi - vec3(0.10), hi, p));',
      '  return s.x * s.y * s.z;',
      '}',
      // Devolve x = atenuação do céu, y = quanto o ponto está dentro.
      'vec2 auraIndoor(vec3 p){',
      '  float k = 1.0, dentro = 0.0;',
      '  for (int i = 0; i < 2; i++) {',
      '    float ins = auraBoxIn(p, uIndoorLo[i], uIndoorHi[i]);',
      // Perto do vidro o céu entra de verdade. A rampa era de 4,6 m e foi
      // para 2,8 m: a 4,6 m de um vão de 3 m de altura a abertura já
      // subtende pouquíssimo do hemisfério, então boa parte do cômodo
      // estava recebendo um reforço de céu que a geometria não justifica.
      // O efeito na imagem era metade da sala lendo clara e azulada.
      '    float win = smoothstep(uIndoorGlassZ[i] - 2.8, uIndoorGlassZ[i] - 0.3, p.z);',
      '    k = min(k, mix(1.0, mix(uIndoorMin, uIndoorWinMax, win), ins));',
      '    dentro = max(dentro, ins);',
      '  }',
      '  return vec2(k, dentro);',
      '}',
    ].join('\n') + '\n' + shader.fragmentShader.replace(
      '#include <lights_fragment_maps>',
      [
        '#include <lights_fragment_maps>',
        '{',
        '  vec2 aura = auraIndoor(vIndoorWPos);',
        // Difuso: troca céu por rebote de parede. Quanto mais o céu foi
        // cortado (1 - k), mais rebote entra — dentro de um cômodo a
        // superfície não vê o nada, vê estuque claro e madeira quente.
        '  iblIrradiance = iblIrradiance * aura.x',
        '                + uIndoorBounce * (uIndoorFill * aura.y * (1.0 - aura.x));',
        // Especular só atenua: rebote difuso de parede não gera reflexo
        // nítido, e somá-lo aqui daria um brilho falso em piso e bancada.
        '  radiance *= aura.x;',
        '}',
      ].join('\n'));
  };
  material.needsUpdate = true;
}

// Normal map procedural de ondulação da água. Gera altura suave a partir
// de senóides sobrepostas e converte para normal tangente. Animando o
// offset dessa textura, a superfície ganha movimento real — sem shader
// customizado e sem arquivo externo.
function waterRippleTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, S, S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
      // três ondas em direções e frequências diferentes = padrão sem
      // repetição óbvia, e contínuo nas bordas (tileable)
      height[y * S + x] =
        Math.sin(u * 2 + v * 1) * 0.5 +
        Math.sin(u * 3 - v * 2) * 0.3 +
        Math.sin(u * 1 + v * 4) * 0.2;
    }
  }
  const at = (x, y) => height[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      // normaliza (-dx, -dy, 1) para o espaço 0..255
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * S + x) * 4;
      img.data[i]     = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;   // mapa de dado, não de cor
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

// Manta de cobertura.
//
// ACHADO RENDERIZANDO a panorâmica: a laje de cobertura ocupa quase um
// terço do quadro visto de cima e era uma cor chapada (#2e2e32, sem mapa
// nenhum). Sem textura e sem escala, ela não lia como superfície — lia
// como buraco preto recortado no meio da casa.
//
// Cobertura plana de verdade é manta asfáltica ou PVC em ROLOS, com
// emenda a cada metro e meio e sujeira acumulada entre elas. A emenda é o
// que dá escala; a sujeira é o que tira o aspecto de plástico novo.
// A emenda cai na borda do ladrilho, então ladrilha sem costura por
// construção: com TILE_M = 1,6 m, sai um rolo de 1,6 m, que é a largura
// real de um rolo.
function roofMembraneTexture(baseHex) {
  const tex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, s, s);
    // manchas largas de envelhecimento
    for (let i = 0; i < 14; i++) {
      const cx = Math.random() * s, cy = Math.random() * s;
      const r = s * (0.10 + Math.random() * 0.22);
      const claro = Math.random() > 0.5;
      wrapDraw(ctx, s, cx, cy, r, () => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, claro ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.075)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }, 'manta');
    }
    // emenda do rolo: uma sombra fina e um lábio claro logo ao lado
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(0, 0, s, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 2, s, 1.5);
    // grão fino, para a manta não ficar plástica
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 11;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function stuccoNoiseTexture(baseHex) {
  const tex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }, 'estuque');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

// ============================================================
// MATERIAIS
// Paleta com as cores confirmadas no .skp original como base de estilo,
// estendida com as categorias que uma casa-showcase detalhada precisa
// (estofados, bancada, metais, cama, tapete). Como o projeto agora é
// declaradamente conceitual, a paleta é autoral — mas mantém a mesma
// família de cores (estuque quente, madeiras cumaru/ipê, travertino,
// grafite) para não descaracterizar o Casa Aura que já existia.
// ============================================================
let M = {};
function buildMaterials() {
  M = {
    // Estuque com relevo: a superfície só tinha mapa de cor, e sob luz
    // rasante lia como papelão pintado. O normal map é o que faz a
    // textura do reboco APARECER quando o sol raspa a fachada.
    estuque:      new THREE.MeshStandardMaterial({
      map: stuccoNoiseTexture('#e9e3d8'),
      normalMap: (() => { const t = noiseNormalTexture(16, 1.1); t.repeat.set(1, 1); return t; })(),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.9, metalness: 0 }),
    // Núcleo em pedra: elemento herói do projeto. Leito bem marcado e
    // relevo, para ler como pedra assentada e não como parede pintada.
    stoneCore:    new THREE.MeshStandardMaterial({
      map: stoneVeinTexture('#8f8579', '#5e5548', { highRes: true, veins: 40, bedding: 0.10 }),
      normalMap: (() => { const t = noiseNormalTexture(12, 1.6); t.repeat.set(1, 1); return t; })(),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.86, metalness: 0 }),
    concreto:     new THREE.MeshStandardMaterial({
      color: 0xc4c2be,
      normalMap: (() => { const t = noiseNormalTexture(10, 0.8); t.repeat.set(1, 1); return t; })(),
      normalScale: new THREE.Vector2(0.2, 0.2),
      roughness: 0.88, metalness: 0 }),
    // ACHADO NA VARREDURA DE QA (captura `qa-exterior-dia`): a cobertura
    // ocupa ~25% do quadro e LIA COMO ÁGUA — azul-marinho com ondulação.
    //
    // Escrevi aqui, na primeira tentativa de correção, que havia três
    // causas: o brilho, um normalMap em escala errada e um `map` esticado.
    // As duas últimas eram INVENÇÃO minha: `sharedBox` passa por
    // `applyWorldUV`, então toda face de caixa já vem com UV em METROS
    // (TILE_M = 1,6). A emenda de rolo já caía a cada 1,6 m — a largura
    // real do rolo — e o `repeat(2,2)` do normalMap já dava célula de
    // ~4 cm. Estava certo. Cheguei a "corrigir" os dois para valores
    // piores antes de ler `applyWorldUV`.
    //
    // A causa é UMA: `roughness 0,52` + `metalness 0,12` + envMap na
    // intensidade cheia = espelho. A manta é quase neutra (#34343a), então
    // TODO o azul vinha do reflexo do céu, e as manchas de envelhecimento
    // da textura modulando esse reflexo é que produziam a "ondulação".
    // O comentário antigo dizia que o brilho existia para a laje "não
    // morrer em preto" — a intenção estava certa, a dose é que estava
    // alta demais.
    //
    // O material também servia a duas coisas que na obra são materiais
    // diferentes: a MANTA da laje e o rufo/capeamento do parapeito.
    // Separados, a manta pode ir para fosco total sem levar junto o
    // capeamento, que é chapa e legitimamente tem um resto de brilho.

    // Rufos, pingadeiras e capeamento de parapeito: chapa escura fosca.
    grafite:      new THREE.MeshStandardMaterial({
      map: stuccoNoiseTexture('#3a3a3f'),
      normalMap: (() => { const t = noiseNormalTexture(18, 0.9); t.repeat.set(2, 2); return t; })(),
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.72, metalness: 0.05, envMapIntensity: 0.55 }),
    // Manta impermeabilizante da laje principal.
    manta:        new THREE.MeshStandardMaterial({
      map: roofMembraneTexture('#34343a'),
      normalMap: (() => { const t = noiseNormalTexture(18, 0.9); t.repeat.set(2, 2); return t; })(),
      normalScale: new THREE.Vector2(0.22, 0.22),
      // Fosca de verdade. O degradê do céu ainda chega — por isso a
      // `envMapIntensity` não é zero — mas como iluminação difusa, e não
      // como imagem refletida.
      roughness: 0.86, metalness: 0, envMapIntensity: 0.35 }),
    cumaru:       new THREE.MeshStandardMaterial({
      map: woodGrainTexture('#76583e', '#3f2c1a', 1, 1, { highRes: true, planks: 5 }),
      roughnessMap: woodRoughnessMap(1, 1, true), roughness: 0.62, metalness: 0.02 }),
    ipe:          new THREE.MeshStandardMaterial({
      map: woodGrainTexture('#604630', '#301f10', 1, 1, { highRes: true, planks: 6 }),
      roughnessMap: woodRoughnessMap(1, 1, true), roughness: 0.66, metalness: 0.02 }),
    madeiraClara: new THREE.MeshStandardMaterial({
      map: woodGrainTexture('#c9a876', '#8a6a42', 1, 1, { highRes: true, planks: 4 }),
      roughnessMap: woodRoughnessMap(1, 1, true), roughness: 0.55, metalness: 0.02 }),
    // forro: madeira clara com leve auto-iluminação. Uma superfície
    // voltada para baixo não recebe sol nem luz do solo — sem isso ela
    // renderiza praticamente preta, que foi o que apareceu nas capturas.
    forroMadeira: new THREE.MeshStandardMaterial({
      map: woodGrainTexture('#d8bb92', '#a3835c', 1, 1), roughness: 0.55, metalness: 0.02,
      emissive: 0x2a2018, emissiveIntensity: 0.35,
    }),
    travertino:   new THREE.MeshStandardMaterial({
      map: stoneVeinTexture('#e2d8c9', '#c7b89f', { highRes: true, veins: 30, bedding: 0.07 }),
      normalMap: (() => { const t = noiseNormalTexture(14, 0.7); t.repeat.set(1, 1); return t; })(),
      normalScale: new THREE.Vector2(0.2, 0.2),
      // envMapIntensity baixo: o piso interno estava captando o azul do
      // ceu como se fosse superficie polida ao ar livre
      roughness: 0.46, metalness: 0, envMapIntensity: 0.35 }),
    // Bancada em pedra polida: veio longo e sutil, superfície lisa.
    bancada:      new THREE.MeshStandardMaterial({
      map: stoneVeinTexture('#f2efe9', '#cfc6b6', { highRes: true, veins: 14, bedding: 0.26 }),
      roughness: 0.16, metalness: 0.05, envMapIntensity: 0.55 }),
    portaEscura:  new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.5, metalness: 0.02 }),
    metal:        new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.35, metalness: 0.85 }),
    latao:        new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 0.9 }),
    // Tecidos com microestrutura. Estofado de cor lisa e roughness
    // constante lê como plástico fosco; a trama é o que dá leitura de
    // tecido, e ela aparece justamente no realce especular fraco.
    tecidoSofa:   new THREE.MeshStandardMaterial({
      color: 0xcabfa9,
      normalMap: (() => { const t = noiseNormalTexture(32, 0.9); t.repeat.set(4, 4); return t; })(),
      normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.95, metalness: 0 }),
    tecidoEscuro: new THREE.MeshStandardMaterial({
      color: 0x6b6459,
      normalMap: (() => { const t = noiseNormalTexture(32, 0.9); t.repeat.set(4, 4); return t; })(),
      normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.9, metalness: 0 }),
    roupaCama:    new THREE.MeshStandardMaterial({
      color: 0xf1ece1,
      normalMap: (() => { const t = noiseNormalTexture(24, 0.7); t.repeat.set(3, 3); return t; })(),
      normalScale: new THREE.Vector2(0.22, 0.22), roughness: 0.88, metalness: 0 }),
    // O normal map é a felpa. Sem ele o tapete tem o padrão certo e a
    // superfície de papel: lã de verdade quebra o realce especular em
    // milhares de fibras, e é isso que separa tapete de adesivo.
    tapete:       new THREE.MeshStandardMaterial({
      map: rugPatternTexture('#d8cdb8', '#a3937a'),
      normalMap: (() => { const t = noiseNormalTexture(48, 1.5); t.repeat.set(10, 10); return t; })(),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 1.0, metalness: 0 }),
    banheira:     new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.25, metalness: 0 }),
    gramado:      new THREE.MeshStandardMaterial({
      // A TRAMA DO GRAMADO vinha daqui, e não do normal map.
      //
      // Medido em cena, cinco configurações num boot só, por
      // autocorrelação 2D de um trecho de gramado aberto:
      //
      //   desligar o normal map     -> pico 0,2590 contra 0,2556: NADA
      //   map.repeat 450 -> 150     -> a defasagem migra de (-9,3)
      //                                para (14,5)
      //
      // O período está preso ao ladrilho do mapa DIFUSO, e aliviar o
      // repeat só o desloca. Ou seja não é aliasing: é o ladrilho ser
      // RECONHECÍVEL. Na bancada (`dev/`), repetindo o ladrilho 4x4 na
      // densidade que ele tem a ~40 m, a assinatura salta aos olhos — e
      // some por completo com `manchas: 0`.
      //
      // As culpadas são as manchas de raio 15%-45% do ladrilho: com
      // ladrilho de 58 cm elas medem 9-26 cm, grandes o bastante para o
      // olho reconhecer e reencontrar a cada 58 cm. Reduzidas a 6%-16%
      // (3,5-9 cm) viram mosqueado em vez de assinatura.
      //
      // A variação de tom que elas davam não se perde: ela já existe, e
      // no lugar certo — `applyMacroVariation(M.gramado, 11.0, 0.16)`
      // logo abaixo faz isso no shader, em 11 m, onde NÃO se repete.
      // Ter as duas era redundante, e a redundante era a que tilava.
      map: grassTexture('#6f8a4f', { manchaMin: 0.06, manchaVar: 0.10 }),
      // ACHADO RENDERIZANDO em ângulo rasante: o gramado inteiro era um
      // acolchoado de losangos, como manta tricotada.
      //
      // Não era filtragem — anisotropia 8 de um máximo de 16, mipmap
      // linear, tudo ligado. Era o normal map: noiseNormalTexture(8, ...)
      // gera uma textura de 128 px com apenas OITO células de ruído, e um
      // padrão de 8 células é quase regular por construção. Repetido 450
      // vezes, com força 2,6, ele deixa de ser relevo de grama e vira
      // trama. Mais células e menos força tiram a regularidade.
      normalMap: noiseNormalTexture(24, 1.15),
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.96, metalness: 0, envMapIntensity: 0.22,
    }),
    // CAMPO DISTANTE — material separado do gramado do lote.
    // ENCONTRADO renderizando: com uma textura só, a repetição alta
    // necessária para ter lâmina de grama perto (2 m por ladrilho)
    // produzia uma GRADE visível no terreno longe, por moiré de mipmap
    // em ângulo rasante. Duas camadas resolvem: o lote fica com o
    // gramado detalhado, e o campo além dele com ladrilho grande e sem
    // detalhe de lâmina, que a essa distância ninguém veria mesmo.
    campoDistante: new THREE.MeshStandardMaterial({
      map: grassTexture('#6a8450'), roughness: 0.98, metalness: 0, envMapIntensity: 0.18,
    }),
    troncoArvore: new THREE.MeshStandardMaterial({ map: barkTexture('#6d5945'), roughness: 0.96, metalness: 0 }),
    // COPAS — cartões recortados em alpha (ver leafCardTexture).
    // alphaTest em vez de transparent: mantém a escrita no depth buffer,
    // então a copa se auto-ordena corretamente e ainda projeta sombra
    // recortada. Transparência ordenada seria mais bonita e muito mais
    // cara, com artefato de ordenação garantido em copa densa.
    copaArvore:   new THREE.MeshStandardMaterial({
      map: leafCardTexture('#5c7a48', { count: 200 }), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.95, metalness: 0, envMapIntensity: 0.3,
    }),
    copaArvore2:  new THREE.MeshStandardMaterial({
      map: leafCardTexture('#7b9755', { leafScale: 0.85, count: 230 }), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.95, metalness: 0, envMapIntensity: 0.3,
    }),
    copaArvore3:  new THREE.MeshStandardMaterial({
      map: leafCardTexture('#4f7150', { narrow: true, count: 260, leafScale: 1.15 }), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.95, metalness: 0, envMapIntensity: 0.28,
    }),
    // Arbusto: folha pequena e densa. Reaproveitar a textura de copa
    // deixava o arbusto ralo, com aspecto de galho seco.
    arbusto:      new THREE.MeshStandardMaterial({
      map: leafCardTexture('#66804d', { count: 720, leafScale: 0.5 }), alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 0.96, metalness: 0, envMapIntensity: 0.28,
    }),
    // Gramínea de primeiro plano: lâminas saindo da base do cartão.
    graminea:     new THREE.MeshStandardMaterial({
      map: grassBladeCardTexture('#8a9a55'), alphaTest: 0.35, side: THREE.DoubleSide,
      roughness: 0.98, metalness: 0, envMapIntensity: 0.25,
    }),
    bordaPiscina: new THREE.MeshStandardMaterial({
      map: stoneVeinTexture('#e0dcd4', '#c9c2b4', { highRes: true, veins: 24, bedding: 0.06 }),
      normalMap: (() => { const t = noiseNormalTexture(14, 0.8); t.repeat.set(1, 1); return t; })(),
      normalScale: new THREE.Vector2(0.24, 0.24),
      roughness: 0.72, metalness: 0 }),
    // O casco e uma CAVIDADE: o GTAO escurece o interior dela (o que esta
    // correto) e o sol rasante nao alcanca o fundo. Somado a absorcao da
    // agua, a piscina saia verde-petroleo escura no render. Um emissivo
    // baixo devolve o que na agua real e espalhamento interno da luz —
    // e o que mantem piscina de revestimento claro luminosa mesmo com o
    // sol baixo. Nao e brilho: 0,3 apenas impede a cavidade de fechar.
    revestPiscina:new THREE.MeshStandardMaterial({
      color: 0x74c0ca, roughness: 0.28, metalness: 0, envMapIntensity: 0.55,
      emissive: 0x3fa8bd, emissiveIntensity: 0.35 }),
    vaso:         new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.8, metalness: 0 }),
    terraco:      new THREE.MeshStandardMaterial({ map: paverTexture('#ded2bd', '#a99a83', 4), roughness: 0.5, metalness: 0 }),
    caminho:      new THREE.MeshStandardMaterial({ map: paverTexture('#c9beac', '#8f8272', 2), roughness: 0.6, metalness: 0 }),
    cascalho:     new THREE.MeshStandardMaterial({ map: gravelTexture('#a89e8c'), roughness: 1.0, metalness: 0 }),
    canteiro:     new THREE.MeshStandardMaterial({ map: gravelTexture('#5a4a37'), roughness: 1.0, metalness: 0 }),
    meioFio:      new THREE.MeshStandardMaterial({ color: 0xb9b2a2, roughness: 0.75, metalness: 0 }),

    vidro: new THREE.MeshPhysicalMaterial({
      // No Three.js, transmission já resolve a transparência por
      // refração. Somar transparent+opacity faz o mesmo trabalho duas
      // vezes, de forma ambígua. Aqui transmission manda sozinha; o
      // fallback opaco fica em adaptMaterialsToQuality() para GPU fraca.
      // O tom anterior (0xa8c6d4) era um ciano forte: a casa inteira lia
      // como aquário nos renders. Vidro arquitetônico low-e real é quase
      // neutro, com um resto de verde-acinzentado, e quem dá a cor é o
      // que ele REFLETE (céu, vegetação) — não um filtro azul no material.
      // Daí o color quase neutro + envMapIntensity mais alto.
      // AJUSTADO renderizando: com envMapIntensity 0,75 e roughness
      // 0,045 o pano de vidro virava um espelho de ceu saturado — a casa
      // lia como bloco ciano de longe. Vidro arquitetonico real tem um
      // microrrelevo que espalha um pouco o reflexo; roughness um pouco
      // maior e reflexo mais fraco entregam a mesma leitura sem a cor
      // chapada.
      // CORRIGIDO depois, olhando o vidro de perto: 0,075 resolvia o
      // reflexo e estragava a TRANSMISSÃO. No Three.js a rugosidade
      // borra o que se vê ATRAVÉS do vidro (o alvo de transmissão é
      // amostrado em mip mais alto), e a sala do outro lado aparecia
      // como um véu leitoso. Quem já estava segurando o reflexo era o
      // envMapIntensity em 0,55; a rugosidade podia voltar a um valor de
      // vidro plano. Vidro arquitetônico é opticamente liso — se ele
      // borra o que está atrás, não é vidro, é acrílico jateado.
      color: 0xe4e8e6, roughness: 0.040, metalness: 0,
      transmission: 0.85, thickness: 0.02, ior: 1.52,
      transparent: false, opacity: 1.0, side: THREE.DoubleSide,
      envMapIntensity: 0.55,
      emissive: 0x000000, emissiveIntensity: 0,
    }),
    // ÁGUA — reconstruída.
    // BUG CORRIGIDO (piscina branca): o scene.environment é um
    // RoomEnvironment (estúdio claro). Com roughness 0.04 + clearcoat 1.0
    // + envMapIntensity padrão (1.0), a água virava um espelho refletindo
    // um ambiente branco — estourando para branco, pior em ângulo
    // rasante, que é exatamente como se olha uma piscina do deck.
    //
    // Três correções:
    // 1. envMapIntensity baixo — reflete o céu, não um estúdio branco.
    // 2. transmission REMOVIDA. Combinada com transparent+opacity ela
    //    entrava em conflito, e no Three.js força um passe extra de
    //    renderização da cena inteira (também era custo de GPU).
    //    Transparência simples entrega a mesma leitura mais barato.
    // 3. roughness/clearcoat plausíveis para água parada de piscina,
    //    não para um espelho.
    // Granito de jardim: cinza, fosco, com relevo proprio. Nao pode ser
    // M.stoneCore — aquele e revestimento estratificado, com fiada de
    // 16 cm desenhada dentro de um ladrilho de 1,6 m. (O comentario dizia
    // "fiada de 1,6 m": confundia o ladrilho com a fiada, e desde a
    // recalibracao para 10 fiadas a conta ficou dez vezes errada.)
    pedraJardim: new THREE.MeshStandardMaterial({
      color: 0x8b8880,
      normalMap: (() => { const t = noiseNormalTexture(22, 1.7); t.repeat.set(2, 2); return t; })(),
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.93, metalness: 0, envMapIntensity: 0.5 }),
    agua: new THREE.MeshPhysicalMaterial({
      color: 0x3f9aad,
      roughness: 0.09, metalness: 0,
      // opacidade baixa de propósito: o argumento de venda da piscina é
      // ver o revestimento e o desnível do fundo ATRAVÉS da água
      transparent: true, opacity: 0.45,
      clearcoat: 0.7, clearcoatRoughness: 0.06,
      // reflexo contido: em ângulo rasante um envMap forte transforma a
      // lâmina em espelho de céu e o fundo desaparece
      envMapIntensity: 0.22,
      normalMap: waterRippleTexture(),
      normalScale: new THREE.Vector2(0.22, 0.22),
      emissive: 0x000000, emissiveIntensity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,   // evita z-fighting com a borda molhada
    }),
  };
  waterNormalMap = M.agua.normalMap;
  // 450 repetições sobre o plano de 900 m = 2 m por ladrilho. Perto da
  // câmera a lâmina de grama tem tamanho plausível; o padrão que essa
  // repetição criaria é dissolvido por applyMacroVariation() logo abaixo.
  M.gramado.map.repeat.set(450, 450);
  // Repetição DIFERENTE da cor, e não múltipla dela: cor e relevo com o
  // mesmo período fazem os dois ladrilhos coincidirem sempre no mesmo
  // ponto, e a coincidência é o que o olho lê como grade. Com períodos
  // incomensuráveis o encontro anda, e o padrão deixa de fechar.
  M.gramado.normalMap.repeat.set(317, 317);
  applyMacroVariation(M.gramado, 11.0, 0.16);
  // 26 m por ladrilho no campo distante, com variação macro forte e de
  // escala grande: o que se lê de longe é a mancha, não a lâmina.
  M.campoDistante.map.repeat.set(35, 35);
  applyMacroVariation(M.campoDistante, 70.0, 0.20);
  M.terraco.map.repeat.set(7, 5);
  M.caminho.map.repeat.set(2, 7);
  M.cascalho.map.repeat.set(5, 4);
  applyMacroVariation(M.cascalho, 3.5, 0.10);
  // A parede cega em pedra mostrava o ladrilho como uma grade de manchas
  // iguais. Mesma correcao aplicada a grama: ruido de escala grande em
  // espaco de mundo, incomensuravel com o periodo do ladrilho.
  applyMacroVariation(M.stoneCore, 4.5, 0.13);
  // ------------------------------------------------------------
  // PBR DERIVADO PARA A ARQUITETURA
  // Estes quatro materiais cobrem quase toda a área de tela do projeto —
  // piso, paredes, lajes e o núcleo de pedra. Passam a ter cor, relevo,
  // rugosidade e oclusão saindo do MESMO campo de altura, em vez de três
  // desenhos independentes que não descrevem a mesma superfície.
  // ------------------------------------------------------------
  const pbrSize = (Quality.level === 'low' || Quality.level === 'medium') ? 256 : 512;
  const _clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v;

  // TRAVERTINO — piso e terraços. Veio de leito horizontal e poros.
  {
    const h = heightField(pbrSize, { octaves: 5, baseFreq: 3, persistence: 0.55, seed: 7 });
    const maps = pbrFromHeight(pbrSize, h, (alt, cav, x, y, size) => {
      // bandas horizontais suaves = leito sedimentar do travertino
      const leito = Math.sin((y / size) * Math.PI * 6 + alt * 2.4) * 0.5 + 0.5;
      const t = alt * 0.55 + leito * 0.45;
      return [_clamp255(214 + t * 32), _clamp255(203 + t * 30), _clamp255(184 + t * 28)];
      // MEDIDO no render da suíte: com roughBase 0,46 e variação 0,34 as
      // saliências caíam em 0,12 de rugosidade — piso espelhado, lendo
      // como molhado. Travertino polido de piso fica em torno de 0,45.
    }, { normalStrength: 1.6, cavityRadius: 3, cavityGain: 10, roughBase: 0.62, roughVar: 0.18,
         aoStrength: 0.7, albedoCavity: 0.26 });
    applyPBR(M.travertino, maps, 0.5);
    M.travertino.envMapIntensity = 0.35;
  }

  // ESTUQUE — reboco fino. Poro pequeno e denso, sem direção.
  {
    // CORRIGIDO renderizando: 5 oitavas a partir de frequência 10 dava
    // detalhe de ~1 cm num ladrilho de 1,6 m. Isso está ABAIXO do que se
    // enxerga a 3 m de distância, então não vira textura — vira ruído e
    // aliasing, e a parede leu como lixa. Reboco fino a essa distância
    // mostra ondulação larga e suave, não grão.
    const h = heightField(pbrSize, { octaves: 3, baseFreq: 3, persistence: 0.5, seed: 19 });
    const maps = pbrFromHeight(pbrSize, h, (alt) => {
      const t = alt;
      return [_clamp255(226 + t * 16), _clamp255(220 + t * 16), _clamp255(208 + t * 15)];
    }, { normalStrength: 0.7, cavityRadius: 3, cavityGain: 4, roughBase: 0.9, roughVar: 0.06,
         aoStrength: 0.22, albedoCavity: 0.07 });
    applyPBR(M.estuque, maps, 0.22);
  }

  // CONCRETO — laje aparente. Mancha larga e poros de fôrma.
  {
    const h = heightField(pbrSize, { octaves: 5, baseFreq: 5, persistence: 0.5, seed: 31 });
    const maps = pbrFromHeight(pbrSize, h, (alt, cav) => {
      const t = alt * 0.8 + 0.1;
      // MEDIDO no render: com base 176 o albedo saía em ~0,75 e a borda
      // da laje estourava, lendo como neve. Concreto real fica em torno
      // de 0,45-0,55 de albedo.
      const v = 118 + t * 26 - Math.max(0, cav) * 18;
      return [_clamp255(v), _clamp255(v * 0.995), _clamp255(v * 0.975)];
    }, { normalStrength: 1.1, cavityRadius: 3, cavityGain: 8, roughBase: 0.9, roughVar: 0.14,
         aoStrength: 0.6, albedoCavity: 0.22 });
    applyPBR(M.concreto, maps, 0.35);
    M.concreto.color.setHex(0xffffff);   // a cor passa a vir do mapa
  }

  // NÚCLEO EM PEDRA — elemento herói.
  // CORRIGIDO renderizando: a versão com bandas senoidais lia como
  // tecido canelado, não como pedra. Junta de alvenaria precisa estar no
  // CAMPO DE ALTURA (para normal, AO e rugosidade acompanharem) e
  // precisa ser irregular, com fiadas de alturas diferentes e juntas
  // verticais desencontradas.
  {
    // AJUSTADO com a captura ampliada de `qa-exterior-dia`: a parede lia
    // como BLOCO DE CONCRETO, não como pedra assentada. Duas causas, e
    // nenhuma delas era falta de variação de tom — a sonda de pixels
    // mediu desvio 18,3 na região, ou seja, a variação existe e chega.
    //
    //  1. A FACE DA PEÇA ERA LISA. `baseFreq: 6` sobre 1,6 m dá feições
    //     de 27 cm — grosso demais para ser grão, fino demais para ser
    //     veio. Caía na faixa em que não se lê nada, e cada peça saía um
    //     degradê limpo. `baseFreq: 12` põe a feição em ~13 cm e a quinta
    //     oitava traz o grão fino de volta. Esta parte funcionou.
    //  2. A PAREDE LIA COMO BLOCO DE CONCRETO — e a causa era a FIADA,
    //     não a junta em si.
    //
    //     Tentei corrigir duas vezes no olho e errei as duas, porque
    //     mexia em junta, tom e número de fiadas ao mesmo tempo e o
    //     resultado só aparecia depois de ~10 min de cena (esta máquina
    //     renderiza a 0,1 quadro por segundo), já misturado com luz,
    //     névoa e vegetação aleatória.
    //
    //     Resolvido com ablação, na bancada de `pedra-lab.ts`, que gera
    //     o albedo pelas mesmas funções e desenha num canvas em segundos:
    //
    //       só o TOM (depth 0, sem junta)      -> NÃO lê como bloco
    //       só a JUNTA (tom chapado)           -> lê como bloco
    //       tom cortado pela metade            -> continua bloco
    //
    //     A junta sozinha produz a leitura inteira. Mas apagá-la deixa a
    //     parede lisa como reboco pintado, o que é pior para um elemento
    //     herói. A saída é a FREQUÊNCIA, não a força: com 3 fiadas por
    //     ladrilho a peça tem 53 cm e o olho lê UNIDADE DE ALVENARIA; com
    //     10 ela cai para 16 cm e o olho lê ESTRATIFICAÇÃO — pedra
    //     assentada, que é o que o projeto quer. Com 14 a modulação
    //     dissolve num chuvisco e a pedra perde caráter.
    //
    //     Um efeito de segunda ordem que só apareceu depois: com peça
    //     PEQUENA o degrau de tom volta a ser visível (com peça de 53 cm
    //     ele era invisível). Por isso a faixa de tom foi recalibrada de
    //     46 para 32 — em 40 a parede começa a listrar, em 24 perde vida.
    //
    //     `baseFreq` 6 -> 12 mais a quinta oitava vieram de antes e
    //     ficam: davam feição de 27 cm, grossa demais para grão e fina
    //     demais para veio, e a face da peça saía um degradê sem
    //     superfície.
    const h = heightField(pbrSize, { octaves: 5, baseFreq: 12, persistence: 0.5, seed: 53 });
    for (let i = 0; i < h.length; i++) h[i] = 0.45 + h[i] * 0.55;   // face do bloco
    const tomBloco = carveCourses(h, pbrSize, { courses: 10, depth: 0.26, jointWidth: 0.003, seed: 11 });
    const maps = pbrFromHeight(pbrSize, h, (alt, cav, x, y, size) => {
      // dois níveis de variação: o tom da PEÇA e o grão DENTRO da peça
      const peca = tomBloco[y * size + x];
      const base = 104 + peca * 32;          // peça a peça
      const grao = alt * 26;                 // grão interno
      const v = base + grao;
      return [_clamp255(v * 1.03), _clamp255(v * 0.98), _clamp255(v * 0.88)];
    }, { normalStrength: 3.0, cavityRadius: 3, cavityGain: 14, roughBase: 0.9, roughVar: 0.1,
         aoStrength: 1.0, albedoCavity: 0.35 });
    applyPBR(M.stoneCore, maps, 1.0);
  }

  // MADEIRAS — piso da ala privativa, deck e forro.
  // O piso do quarto (madeiraClara) saía azul-ardósia no render: com
  // roughness ~0,5 e envMapIntensity 1, uma superfície HORIZONTAL reflete
  // o céu bem no lóbulo especular e a reflexão azul domina o albedo
  // quente. Piso de madeira é fosco-acetinado e não espelha o céu.
  [
    ['madeiraClara', 0xc9a876, 0x8a6a42, 6, 0.68, 0.20],
    ['cumaru',       0x76583e, 0x3f2c1a, 5, 0.66, 0.22],
    ['ipe',          0x604630, 0x301f10, 7, 0.70, 0.24],
  ].forEach(([nome, baseHex, veioHex, tabuas, rough, envI]) => {
    const mat = M[nome];
    if (!mat) return;
    const bR = (baseHex >> 16) & 255, bG = (baseHex >> 8) & 255, bB = baseHex & 255;
    const vR = (veioHex >> 16) & 255, vG = (veioHex >> 8) & 255, vB = veioHex & 255;
    const h = heightField(pbrSize, { octaves: 4, baseFreq: 2, persistence: 0.6, seed: 71 + tabuas });
    // veio: alonga o ruído no sentido da tábua
    const hv = new Float32Array(h.length);
    for (let y = 0; y < pbrSize; y++) {
      for (let x = 0; x < pbrSize; x++) {
        const yy = Math.floor(y / 6) * 6;   // estica 6x no comprimento
        hv[y * pbrSize + x] = h[yy * pbrSize + x];
      }
    }
    const tomTab = carvePlanks(hv, pbrSize, { planks: tabuas, depth: 0.45, jointWidth: 0.004, seed: 13 + tabuas });
    const maps = pbrFromHeight(pbrSize, hv, (alt, cav, x, y, size) => {
      const peca = tomTab[y * size + x];
      // mistura base↔veio pelo relevo, e desloca o tom peça a peça
      const k = Math.min(1, Math.max(0, alt * 0.85 + peca * 0.3 - 0.1));
      return [_clamp255(vR + (bR - vR) * k), _clamp255(vG + (bG - vG) * k), _clamp255(vB + (bB - vB) * k)];
    }, { normalStrength: 1.4, cavityRadius: 3, cavityGain: 11, roughBase: rough, roughVar: 0.12,
         aoStrength: 0.8, albedoCavity: 0.34 });
    applyPBR(mat, maps, 0.55);
    mat.color.setHex(0xffffff);
    mat.envMapIntensity = envI;
    mat.metalness = 0.0;
  });

  // Reboco pintado é quase uniforme. 6 m de escala com 5,5% de amplitude
  // desenhava nuvens do tamanho da parede — com o ruído já corrigido para
  // variar na vertical, aquilo viraria mancha de umidade em vez de
  // textura. Escala menor e amplitude menor: mosqueado de reboco, que
  // aparece de perto e some de longe.
  applyMacroVariation(M.estuque, 2.2, 0.028);

  // Balizadores de fachada. Posições escolhidas onde existe PAREDE OPACA
  // para lavar: a fachada norte, as duas empenas laterais e o núcleo de
  // pedra. Na fachada sul não faz sentido — ali é vidro, e quem ilumina
  // é a luz que vaza de dentro.
  const balizadores = [
    [-9.0, 0.05, -6.45], [-3.0, 0.05, -6.45], [3.0, 0.05, -6.45], [9.0, 0.05, -6.45],
    [-13.35, 0.05, -2.0], [-13.35, 0.05, 2.5],
    [12.35, 0.05, -2.0], [12.35, 0.05, 2.5],
  ];
  // Em aparelho fraco, metade dos pontos: o laço é desenrolado no shader,
  // então o número de pontos é literalmente o número de iterações.
  const balizadoresTier = (Quality.level === 'low' || Quality.level === 'medium')
    ? balizadores.filter((_, i) => i % 2 === 0)
    : balizadores;
  applyUplightWash(M.estuque, balizadoresTier, 3.6, 3.4);
  applyUplightWash(M.stoneCore, [[3.4, 0.05, -4.2], [3.4, 0.05, 3.6]], 3.0, 4.6);
  applyMacroVariation(M.travertino, 5.0, 0.06);

  // ------------------------------------------------------------
  // RESPOSTA AO AMBIENTE, POR MATERIAL
  // ------------------------------------------------------------
  // Esta tabela já foi uma tentativa de resolver "superfície interna
  // recebendo o céu inteiro" baixando envMapIntensity de todo material que
  // costuma viver dentro de casa. Não funcionava, por duas razões:
  //
  //  - não é propriedade do material, é da POSIÇÃO. madeiraClara é o piso
  //    do quarto E o piso do terraço superior; metal é o puxador E os
  //    montantes da fachada; latão é a base do abajur E as ferragens
  //    externas. Baixar o material escurecia o lado de fora junto.
  //  - o sintoma reaparecia na superfície seguinte a cada render. Eu
  //    corrigi parede, depois tapete, depois piso do quarto, e o quarto
  //    defeito estava esperando.
  //
  // Quem cuida de dentro-versus-fora agora é applyIndoorOcclusion(), que
  // é geométrica e vale para todo material de uma vez. O que sobra aqui é
  // o que realmente é propriedade do material: tecido fosco reflete pouco
  // ambiente, latão polido reflete muito. Valores de volta a patamares
  // físicos — a máscara é que multiplica por fora.
  const respostaAoAmbiente = {
    tapete: 0.30, tecidoSofa: 0.30, tecidoEscuro: 0.28, roupaCama: 0.34,
    banheira: 0.55, vaso: 0.45, portaEscura: 0.40, bancada: 0.65,
    madeiraClara: 0.45, forroMadeira: 0.38, latao: 0.90, metal: 1.00,
  };
  Object.keys(respostaAoAmbiente).forEach(k => { if (M[k]) M[k].envMapIntensity = respostaAoAmbiente[k]; });

  // Sem anisotropia, uma textura repetida 450x vira ruído cintilante em
  // ângulo rasante — que é exatamente como se olha um gramado.
  const aniso = (renderer && renderer.capabilities)
    ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  // Inclui os mapas PBR derivados: eles substituíram os objetos de
  // textura originais, então precisam receber anisotropia também.
  [M.gramado.map, M.gramado.normalMap, M.campoDistante.map,
   M.terraco.map, M.caminho.map, M.cascalho.map,
   M.travertino.map, M.travertino.normalMap, M.travertino.roughnessMap, M.travertino.aoMap,
   M.estuque.map, M.estuque.normalMap, M.estuque.roughnessMap, M.estuque.aoMap,
   M.concreto.map, M.concreto.normalMap, M.concreto.roughnessMap, M.concreto.aoMap,
   M.stoneCore.map, M.stoneCore.normalMap, M.stoneCore.roughnessMap, M.stoneCore.aoMap,
   M.madeiraClara.map, M.madeiraClara.normalMap, M.madeiraClara.roughnessMap, M.madeiraClara.aoMap,
   M.cumaru.map, M.cumaru.normalMap, M.cumaru.roughnessMap, M.cumaru.aoMap,
   M.ipe.map, M.ipe.normalMap, M.ipe.roughnessMap, M.ipe.aoMap,
   // A cobertura é quase sempre vista em ângulo rasante (a câmera fica
   // abaixo dela em toda vista de fachada). Sem anisotropia a manta vira
   // uma faixa cinza borrada exatamente onde ela tem mais área na tela —
   // era o caso: nenhum dos dois mapas estava nesta lista.
   M.manta.map, M.manta.normalMap,
   M.grafite.map, M.grafite.normalMap]
    .forEach(t => { if (t) t.anisotropy = aniso; });

  glassMaterial = M.vidro;
  waterMaterial = M.agua;
}

// ============================================================
// ORÇAMENTO DE LUZ — a correção nº1 de performance
// ------------------------------------------------------------
// MEDIDO: a versão anterior tinha 48 PointLights. O shader do
// MeshStandardMaterial avalia TODAS as luzes por fragmento, então 48
// luzes multiplicam o custo de cada pixel — era esse o travamento, não
// a geometria (a cena tem só ~19 mil triângulos).
//
// Solução: um orçamento rígido de luzes reais. Luminárias além do
// orçamento viram APENAS emissivas — o material brilha (o usuário vê a
// luminária acesa) mas não ilumina a cena, e custa ZERO no cálculo de
// iluminação. Visualmente a diferença é pequena; em GPU é enorme.
// ============================================================
const LIGHT_BUDGET = { ultra: 6, high: 4, medium: 2, low: 1 };
let lightBudgetLeft = 4;
let emissiveFixtures = [];   // materiais que só brilham (custo zero)

// Registra uma luminária. Se ainda há orçamento, cria PointLight real.
// Caso contrário, registra só o material emissivo.
function addFixture(group, pos, color, emissiveMat, dist, importance) {
  if (emissiveMat) emissiveFixtures.push(emissiveMat);
  // 'emissive-only' NUNCA vira luz real — só brilha. (Bug corrigido: a
  // versão anterior desta função ainda gastava orçamento com elas.)
  if (importance === 'emissive-only') return null;
  if (importance !== 'hero' && lightBudgetLeft <= 0) return null;
  const l = new THREE.PointLight(color || 0xffd9a8, 0, dist || 4, 2);
  l.position.set(pos[0], pos[1], pos[2]);
  group.add(l);
  lampLights.push(l);
  if (importance !== 'hero') lightBudgetLeft--;
  return l;
}

// ============================================================
// CACHE DE GEOMETRIA COMPARTILHADA
// MEDIDO: 872 geometrias criadas, zero reutilizadas. Geometrias iguais
// agora são criadas uma vez só e compartilhadas entre meshes.
// ============================================================
// ============================================================
// PERF — numeros de boot e de quadro, sempre coletados
// ------------------------------------------------------------
// Regra da casa nesta base: sem numero, nao foi feito. Este objeto e o
// lugar unico onde os numeros vivem, para o painel de debug, o arnes de
// teste e o rebaixamento automatico de tier lerem a MESMA fonte.
// ============================================================
const Perf = {
  steps: [],            // [nome, ms] por etapa de buildScene
  bootMs: 0,            // do inicio de buildScene ate a cena pronta
  texturasMs: 0,        // tempo gasto so gerando textura procedural
  texturasN: 0,
  frameMs: 0,           // media movel do tempo de quadro
  gpuMs: null,          // preenchido se a extensao de timer existir
  quadros: 0,
  piorFps: null,   // o percentil baixo dói mais que a média
  porTextura: [],   // [rotulo, ms] de cada geracao
};
const _geoCache = new Map();
// ============================================================
// UV EM ESCALA REAL — a correção da textura esticada
// ------------------------------------------------------------
// ENCONTRADO renderizando (recorte ampliado do portal de entrada): o
// veio da pedra aparecia como fios verticais finos percorrendo o painel
// inteiro, e a madeira da porta lia como marrom chapado. Causa: a
// BoxGeometry gera UV de 0 a 1 em CADA face, independentemente do
// tamanho. Uma parede de 14 m e um puxador de 12 cm recebem exatamente
// o mesmo trecho de textura — então a mesma imagem aparece minúscula num
// e esticada no outro.
//
// Aqui a UV passa a ser proporcional às dimensões reais em metros: uma
// unidade de textura cobre TILE_M metros de superfície, em qualquer
// objeto. É o que faz o mesmo material de pedra ter veio do mesmo
// tamanho na bancada e na fachada.
const TILE_M = 1.6;   // metros cobertos por uma repetição da textura

// Ordem das faces na BoxGeometry: +x, -x, +y, -y, +z, -z (4 vértices
// cada, com 1 segmento). Para cada uma, quais dimensões reais ocupam u e v.
function applyWorldUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  const faceDims = [
    [d, h], [d, h],   // ±x
    [w, d], [w, d],   // ±y
    [w, h], [w, h],   // ±z
  ];
  const per = uv.count / 6;   // vértices por face
  for (let f = 0; f < 6; f++) {
    const su = faceDims[f][0] / TILE_M;
    const sv = faceDims[f][1] / TILE_M;
    for (let i = 0; i < per; i++) {
      const k = f * per + i;
      uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function sharedBox(w, h, d) {
  const k = 'b' + w.toFixed(3) + '_' + h.toFixed(3) + '_' + d.toFixed(3);
  let g = _geoCache.get(k);
  if (!g) { g = applyWorldUV(new THREE.BoxGeometry(w, h, d), w, h, d); _geoCache.set(k, g); }
  return g;
}
function sharedCyl(rt, rb, h, seg) {
  const k = 'c' + rt.toFixed(3) + '_' + rb.toFixed(3) + '_' + h.toFixed(3) + '_' + seg;
  let g = _geoCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg); _geoCache.set(k, g); }
  return g;
}

// ============================================================
// INSTANCING
// MEDIDO: 259 meshes só de folhas de grama + 138 de folhagem. Cada mesh
// é 1 draw call. Instanciados, viram 1 draw call cada grupo.
// ============================================================
function buildInstanced(geo, mat, transforms, castShadow) {
  if (!transforms.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, transforms.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eu = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i];
    eu.set(t.rx || 0, t.ry || 0, t.rz || 0);
    q.setFromEuler(eu);
    p.set(t.x, t.y, t.z);
    sc.set(t.sx || 1, t.sy || 1, t.sz || 1);
    m.compose(p, q, sc);
    im.setMatrixAt(i, m);
  }
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = !!castShadow;
  im.receiveShadow = true;
  return im;
}

// ------------------------------------------------------------
// INSTANCING SETORIZADO
// Um InstancedMesh tem UMA esfera envolvente, que cobre todas as
// instâncias. O anel de mata distante é um círculo de 130 m de raio em
// volta da casa: a esfera dele contém a câmera SEMPRE, então o frustum
// culling nunca descarta nada e os ~1.000 cartões do anel inteiro são
// rasterizados a cada frame — inclusive os que estão atrás da câmera.
// Em cartão com alphaTest isso é custo de preenchimento puro, que é
// justamente o gargalo em GPU de celular.
//
// Dividindo o anel em setores angulares, cada setor vira um mesh com
// esfera pequena, e o frustum descarta os que estão fora de vista. Sai
// de 1 chamada sempre desenhando tudo para ~4 chamadas desenhando
// tipicamente 1 ou 2.
// ------------------------------------------------------------
function buildInstancedSectors(geo, mat, transforms, castShadow, sectors) {
  const n = sectors || 6;
  const out = [];
  const baldes = [];
  for (let i = 0; i < n; i++) baldes.push([]);
  for (const t of transforms) {
    let a = Math.atan2(t.z, t.x);
    if (a < 0) a += Math.PI * 2;
    baldes[Math.min(n - 1, Math.floor((a / (Math.PI * 2)) * n))].push(t);
  }
  for (const b of baldes) {
    const im = buildInstanced(geo, mat, b, castShadow);
    if (im) out.push(im);
  }
  return out;
}

// ============================================================
// GEOMETRIA CHANFRADA — a mudança de raiz
// ------------------------------------------------------------
// A causa raiz do aspecto de maquete não era iluminação: era que TODO
// objeto era uma BoxGeometry de arestas vivas. Aresta perfeitamente viva
// não existe em objeto fabricado, e o olho reconhece isso na hora — a
// aresta chanfrada é o que captura um brilho especular fino e faz o
// cérebro ler "objeto real" em vez de "primitiva".
//
// rbox() substitui box() em MOBILIÁRIO. Arquitetura (paredes, lajes)
// continua com aresta viva, que é o correto para concreto e alvenaria.
// ============================================================
function sharedRoundedBox(w, h, d) {
  const r = Math.min(0.022, w * 0.12, h * 0.12, d * 0.12);
  const k = 'r' + w.toFixed(3) + '_' + h.toFixed(3) + '_' + d.toFixed(3);
  let g = _geoCache.get(k);
  if (!g) { g = new RoundedBoxGeometry(w, h, d, 2, r); _geoCache.set(k, g); }
  return g;
}
function rbox(w, h, d, mat, castShadow) {
  const m = new THREE.Mesh(sharedRoundedBox(w, h, d), mat);
  m.castShadow = castShadow !== false;
  m.receiveShadow = true;
  m.userData.maxDim = Math.max(w, h, d);
  return m;
}

// Matacão de jardim.
//
// ACHADO RENDERIZANDO o capítulo "Paisagismo": as pedras decorativas eram
// IcosahedronGeometry(1, 0) — o sólido platônico cru, 20 faces — vestido
// com M.stoneCore, que é o revestimento de pedra da casa, com fiada e
// junta desenhadas para ladrilho de 1,6 m. Numa pedra de 50 cm aquilo dava
// um cristal branco facetado: lia como gema de jogo, não como matacão.
//
// Pedra de verdade não tem face plana nem aresta reta. Duas subdivisões
// mais deslocamento por direção resolvem a silhueta, e três senóides
// incomensuráveis garantem que nenhuma pedra fique igual à outra sem
// precisar de ruído tabelado.
function boulderGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d = Math.sin(n.x * 3.1 + seed) * 0.10
            + Math.sin(n.y * 4.7 + seed * 1.7) * 0.075
            + Math.sin(n.z * 6.3 + seed * 2.3) * 0.055;
    v.multiplyScalar(1 + d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// Perfil torneado real (LatheGeometry) para vasos, cúpulas e bases —
// silhueta curva de verdade, não cilindro.
function latheProfile(points, segments, mat) {
  const pts = points.map(p => new THREE.Vector2(p[0], p[1]));
  const g = new THREE.LatheGeometry(pts, segments || 20);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ============================================================
// CONTACT SHADOWS
// Móveis apoiados no piso sem sombra de contato "flutuam" — o olho não
// encontra o ponto de apoio. Um plane com gradiente radial em
// MultiplyBlending resolve isso com custo ZERO de iluminação. É o
// melhor ganho por custo de todo o projeto.
// ============================================================
let _shadowTex = null;
function getShadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  // CORRIGIDO APÓS RENDERIZAR: com MultiplyBlending o resultado é
  // dst * src, e o alpha NÃO entra no fator. Uma textura preta
  // transparente multiplica por ZERO nas bordas e produz um retângulo
  // preto duro — foi exatamente o que apareceu no render. A textura de
  // sombra por multiplicação precisa ser BRANCA fora (multiplica por 1,
  // não altera nada) e escura só no centro.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0.00, '#565656');
  g.addColorStop(0.35, '#9a9a9a');
  g.addColorStop(0.70, '#dcdcdc');
  g.addColorStop(1.00, '#ffffff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}
let _shadowMat = null;
// MEDIDO: o parâmetro `opacity` desta função NUNCA teve efeito nenhum, e
// pagava caro por isso.
//
// Com MultiplyBlending o Three.js usa blendFuncSeparate(ZERO, SRC_COLOR,
// ZERO, SRC_ALPHA): o RGB final é dst * src.rgb. `opacity` escala apenas
// diffuseColor.a, que não entra nessa conta. Provado na cena, com a
// câmera sobre uma sombra e o resto escondido:
//
//   todas as 27 forçadas ao mesmo material  ->  luminância idêntica
//   opacidade 0 em todas                    ->  luminância idêntica
//
// Ou seja: as 14 chamadas com opacidade diferente geravam 27 CLONES de
// material — 27 materiais, 27 draw calls e 27 variantes de programa — e
// as 27 sombras já renderizavam todas com a mesma força. O parâmetro
// continua na assinatura porque as chamadas o passam, mas agora está
// documentado como inerte em vez de custar um material cada.
//
// (Confirmado que as sombras FUNCIONAM antes de mexer: numa cena só com
// piso e sombras, elas escurecem o travertino de 254,3 para 200,8. O
// primeiro teste deu "invisíveis" porque a câmera estava em cima delas e
// o móvel ficava na frente — o raycast mostrou três hits antes.)
//
// Para reativar força por sombra seria preciso outra mecânica: clarear um
// multiply exige mix(1.0, mapa, força), que multiplicação de vértice não
// faz. Ficaria como um segundo mapa ou um shader próprio; não vale um
// material por móvel.
function addContactShadow(parentGroup, w, d, opacity, yOffset) {
  if (!_shadowMat) {
    _shadowMat = new THREE.MeshBasicMaterial({
      map: getShadowTexture(), transparent: true, opacity: 1.0,
      depthWrite: false, blending: THREE.MultiplyBlending,
    });
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), _shadowMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset || 0.012;
  mesh.renderOrder = 1;
  // Marca para o passe de fusão: multiplicação é comutativa, então estas
  // podem ser fundidas entre si sem alterar o resultado, mesmo sendo
  // transparentes — o que a fusão estática normal não pode assumir.
  mesh.userData.contactShadow = true;
  parentGroup.add(mesh);
  return mesh;
}

function box(w, h, d, mat, castShadow) {
  const m = new THREE.Mesh(sharedBox(w, h, d), mat);
  m.castShadow = castShadow !== false;
  m.receiveShadow = true;
  // guarda a maior dimensão: optimizeShadowCasters() usa isso em vez de
  // ler geometry.parameters, funcionando de forma confiável em qualquer caso
  m.userData.maxDim = Math.max(w, h, d);
  return m;
}

// ============================================================
// ARQUITETURA — estrutura principal
// Massa de dois blocos (ala social + ala privativa) separados por um
// núcleo de pedra, com um volume superior em balanço. Todas as coberturas
// têm parapeito nos quatro lados e espessura real — o problema relatado
// de "parecer sem telhado em alguns ângulos" vinha de lajes sem parapeito
// e sem espessura suficiente.
// ============================================================
function buildArchitecture() {
  const arch = new THREE.Group();

  // --- Fundação / base ---
  const base = box(23.9, 0.3, 12.9, M.concreto);
  base.position.set(0.65, -0.15, 0);
  arch.add(base);

  // --- Piso térreo (ala social + ala privativa) ---
  const floorSocial = box(13.9, 0.12, 12, M.travertino, false);
  floorSocial.position.set(-4.15, 0.06, 0);
  arch.add(floorSocial);
  const floorPrivate = box(8, 0.12, 12, M.madeiraClara, false);
  floorPrivate.position.set(8, 0.06, 0);
  arch.add(floorPrivate);

  // --- Ala social: paredes (norte sólida, oeste com vidro, sul toda em vidro) ---
  const socialBackWall = box(14.2, 3.2, 0.22, M.estuque);
  socialBackWall.position.set(-4.15, 1.6, -6.1);
  arch.add(socialBackWall);

  const socialWestWall = box(0.22, 3.2, 12.2, M.estuque);
  socialWestWall.position.set(-11.1, 1.6, 0);
  arch.add(socialWestWall);
  // janela oeste (recorte visual: painel de vidro sobre a parede)
  const westWindow = box(0.06, 1.6, 3.2, M.vidro, false);
  westWindow.position.set(-11.1, 1.8, -3);
  arch.add(westWindow);

  // fachada sul (vidro do piso ao teto, com mainéis finos)
  const glassSouthSocial = box(14, 3.0, 0.05, M.vidro, false);
  glassSouthSocial.position.set(-4.15, 1.55, 6.0);
  arch.add(glassSouthSocial);
  for (let gx = -10.8; gx <= 2.2; gx += 2.35) {
    const mullion = box(0.06, 3.05, 0.1, M.metal);
    mullion.position.set(gx, 1.6, 6.0);
    arch.add(mullion);
  }
  const socialSill = box(14, 0.1, 0.15, M.concreto);
  socialSill.position.set(-4.15, 0.03, 6.02);
  arch.add(socialSill);

  // --- Núcleo de pedra (circulação), parcial em Z para permitir passagem ---
  const stoneCore = box(1.6, 6.8, 7.0, M.stoneCore);
  stoneCore.position.set(3.4, 3.4, -2.5);
  arch.add(stoneCore);

  // --- Ala privativa (suíte): paredes ---
  const privateBackWall = box(8.2, 3.2, 0.22, M.estuque);
  privateBackWall.position.set(8, 1.6, -6.1);
  arch.add(privateBackWall);
  const privateEastWall = box(0.22, 3.2, 12.2, M.estuque);
  privateEastWall.position.set(12.1, 1.6, 0);
  arch.add(privateEastWall);
  const eastWindow = box(0.06, 1.6, 3.2, M.vidro, false);
  eastWindow.position.set(12.1, 1.8, -3);
  arch.add(eastWindow);

  const glassSouthPrivate = box(8, 3.0, 0.05, M.vidro, false);
  glassSouthPrivate.position.set(8, 1.55, 6.0);
  arch.add(glassSouthPrivate);
  for (let gx = 4.4; gx <= 11.6; gx += 2.4) {
    const mullion = box(0.06, 3.05, 0.1, M.metal);
    mullion.position.set(gx, 1.6, 6.0);
    arch.add(mullion);
  }

  // --- Porta de entrada (fachada norte, ala privativa) ---
  const door = box(1.3, 2.6, 0.11, M.cumaru);
  door.position.set(9.3, 1.3, -6.34);
  arch.add(door);
  const doorFrame = box(1.5, 2.8, 0.12, M.metal);
  doorFrame.position.set(9.3, 1.4, -6.30);
  arch.add(doorFrame);
  const handle = createDoorHandle();
  handle.position.set(9.78, 1.25, -6.40);
  arch.add(handle);
  // ============================================================
  // ARTICULAÇÃO DAS FACHADAS CEGAS
  // Encontrado renderizando: as fachadas norte e oeste eram planos de
  // estuque de 8 e 12 m sem nenhum elemento — qualquer câmera apontada
  // para elas produzia um retângulo cinza. Não era enquadramento ruim,
  // era falta de arquitetura. Portal em pedra, rasgos verticais e brise
  // resolvem na geometria.
  // ============================================================

  // Portal de entrada recuado, revestido em pedra
  const portal = box(3.6, 3.0, 0.28, M.bordaPiscina);
  portal.position.set(9.5, 1.5, -6.25);
  arch.add(portal);
  const portalReveal = box(3.9, 0.1, 0.36, M.grafite);
  portalReveal.position.set(9.5, 3.08, -6.30);
  arch.add(portalReveal);
  // bandeira de vidro ao lado da porta, para a entrada respirar
  const sidelight = box(0.5, 2.3, 0.06, M.vidro, false);
  sidelight.position.set(10.75, 1.15, -6.33);
  arch.add(sidelight);

  // Rasgos horizontais na fachada norte (juntas de sombra)
  for (const ry of [1.05, 2.15]) {
    const reveal = box(7.4, 0.05, 0.05, M.grafite, false);
    reveal.position.set(5.4, ry, -6.22);
    arch.add(reveal);
  }
  // Janela alta e estreita iluminando a circulação
  const slot = box(0.35, 1.9, 0.06, M.vidro, false);
  slot.position.set(5.2, 1.7, -6.05);
  arch.add(slot);

  // Brise vertical em cumaru na fachada oeste — linguagem contemporânea
  // brasileira, e resolve o plano cego de 12 m
  for (let bz = -4.6; bz <= 4.8; bz += 0.42) {
    const batten = box(0.09, 2.9, 0.09, M.cumaru);
    batten.position.set(-11.32, 1.6, bz);
    arch.add(batten);
  }
  const briseTop = box(0.22, 0.12, 9.9, M.metal);
  briseTop.position.set(-11.32, 3.12, 0.1);
  arch.add(briseTop);
  const briseBase = box(0.22, 0.1, 9.9, M.concreto);
  briseBase.position.set(-11.32, 0.1, 0.1);
  arch.add(briseBase);

  const canopy = box(2.4, 0.1, 1.6, M.concreto);
  canopy.position.set(9.5, 2.55, -6.8);
  arch.add(canopy);
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0xf2ede2, roughness: 0.8, emissive: 0xffdca8, emissiveIntensity: 0,
  });
  const canopyPanel = box(1.6, 0.02, 0.9, canopyMat, false);
  canopyPanel.position.set(9.5, 2.48, -6.8);
  arch.add(canopyPanel);
  emissiveFixtures.push(canopyMat);

  // --- Laje de cobertura do térreo (dupla função: piso do balanço em cima,
  // forro de madeira por baixo) + parapeito completo nos 4 lados ---
  // A partir daqui tudo vai para upperMass, um grupo separado que o
  // "Modo Corte" consegue erguer para revelar a planta do térreo.
  upperMass = new THREE.Group();
  // Raiz de fusão própria: sobe no Modo Corte, então não pode ser
  // fundida junto com a arquitetura fixa.
  upperMass.userData.mergeRoot = true;

  const roofSlabGeo = new THREE.BoxGeometry(24.6, 0.35, 13.0);
  // A face de baixo (forro) era Cumaru escuro. Nenhuma luz bate nela por
  // baixo, então lia como preto nas capturas. Madeira clara resolve sem
  // perder a linguagem de forro de madeira.
  // A face de cima estava em madeira clara: os 24,6 x 13 m de laje
  // renderizavam como um deck de madeira gigante e vazio — a origem da
  // leitura de "terraço inacabado" nas vistas aéreas. Telhado plano de
  // casa contemporânea é impermeabilizado, não deck. O deck de madeira
  // volta só onde existe terraço de verdade (abaixo).
  const roofSlabMats = [M.concreto, M.concreto, M.manta, M.forroMadeira, M.concreto, M.concreto];
  const roofSlab = new THREE.Mesh(roofSlabGeo, roofSlabMats);
  roofSlab.position.set(0.4, 3.35, 0);
  roofSlab.castShadow = true; roofSlab.receiveShadow = true;
  upperMass.add(roofSlab);
  addParapet(upperMass, 0.4, 3.53, 0, 24.6, 13.0, 0.45, M.grafite);

  // --- Volume superior (balanço) ---
  const upperFloor = box(14.4, 0.1, 10.2, M.madeiraClara, false);
  upperFloor.position.set(-6, 3.58, 0);
  upperMass.add(upperFloor);

  // Deck de madeira apenas na pegada real do terraço utilizável.
  const terraceDeck = box(5.4, 0.06, 9.4, M.ipe, false);
  terraceDeck.position.set(-1.4, 3.62, 0);
  upperMass.add(terraceDeck);

  const upperBackWall = box(14.4, 3.0, 0.2, M.cumaru);
  upperBackWall.position.set(-6, 5.08, -4.9);
  upperMass.add(upperBackWall);
  const upperWestWall = box(0.2, 3.0, 10.2, M.cumaru);
  upperWestWall.position.set(-13.1, 5.08, 0);
  upperMass.add(upperWestWall);
  const upperWestGlass = box(0.06, 1.8, 3.4, M.vidro, false);
  upperWestGlass.position.set(-13.1, 5.2, -1.2);
  upperMass.add(upperWestGlass);

  // fachada sul do balanço: parte vidro (quarto) + parte aberta (terraço)
  const upperGlassSouth = box(8.4, 2.8, 0.05, M.vidro, false);
  upperGlassSouth.position.set(-8.8, 5.0, 4.9);
  upperMass.add(upperGlassSouth);
  for (let gx = -12.9; gx <= -4.7; gx += 2.05) {
    const mullion = box(0.05, 2.85, 0.08, M.metal);
    mullion.position.set(gx, 5.0, 4.9);
    upperMass.add(mullion);
  }
  // guarda-corpo de vidro do terraço
  const terraceRail = box(6.2, 0.9, 0.04, M.vidro, false);
  terraceRail.position.set(-1.6, 4.05, 4.9);
  upperMass.add(terraceRail);
  const railTop = box(6.2, 0.06, 0.1, M.metal);
  railTop.position.set(-1.6, 4.5, 4.9);
  upperMass.add(railTop);

  // Fechamento entre o quarto/escritório fechado e o terraço aberto.
  // Sem isso a cama ficava num espaço escancarado para o terraço, e a
  // leitura era "faltou uma parede". Com o painel + porta de vidro, o
  // terraço passa a ser INTENCIONALMENTE aberto, e o quarto, fechado.
  const upperPartition = box(0.16, 3.0, 4.6, M.cumaru);
  upperPartition.position.set(-4.3, 5.08, -2.6);
  upperMass.add(upperPartition);
  const upperSlider = box(0.05, 2.8, 4.6, M.vidro, false);
  upperSlider.position.set(-4.3, 4.98, 2.3);
  upperMass.add(upperSlider);
  for (const sz of [0.1, 2.3, 4.5]) {
    const mull = box(0.07, 2.85, 0.07, M.metal);
    mull.position.set(-4.3, 5.0, sz);
    upperMass.add(mull);
  }

  // laje de cobertura do balanço + parapeito
  // A cobertura cobria TAMBÉM o terraço, deixando-o escuro e ambíguo
  // (parecia um cômodo sem parede). Agora cobre apenas o volume fechado:
  // o terraço fica aberto para o céu, que é o que define um terraço.
  const upperRoof = box(9.4, 0.3, 10.6, M.concreto);
  upperRoof.position.set(-8.5, 6.65, 0);
  upperMass.add(upperRoof);
  addParapet(upperMass, -8.5, 6.82, 0, 9.4, 10.6, 0.4, M.grafite);
  // Guarda-corpo de vidro fechando o perímetro aberto do terraço
  for (const [gx, gz, gw, gd] of [[-1.4, -4.75, 5.6, 0.05], [-1.4, 4.75, 5.6, 0.05], [1.35, 0, 0.05, 9.5]]) {
    const rail = box(gw, 1.05, gd, M.vidro, false);
    rail.position.set(gx, 4.18, gz);
    upperMass.add(rail);
    const cap = box(gw + 0.06, 0.05, gd + 0.06, M.metal);
    cap.position.set(gx, 4.72, gz);
    upperMass.add(cap);
  }

  arch.add(upperMass);
  houseGroup.add(arch);
  return arch;
}

// Parapeito completo nos 4 lados de uma laje retangular — garante que a
// cobertura pareça fechada de qualquer ângulo de câmera.
function addParapet(group, cx, topY, cz, w, d, h, mat) {
  const t = 0.15;
  const north = box(w, h, t, mat); north.position.set(cx, topY + h / 2, cz - d / 2 + t / 2); group.add(north);
  const south = box(w, h, t, mat); south.position.set(cx, topY + h / 2, cz + d / 2 - t / 2); group.add(south);
  const west = box(t, h, d, mat); west.position.set(cx - w / 2 + t / 2, topY + h / 2, cz); group.add(west);
  const east = box(t, h, d, mat); east.position.set(cx + w / 2 - t / 2, topY + h / 2, cz); group.add(east);
}

// ============================================================
// MOBILIÁRIO — funções reutilizáveis
// ============================================================
function createWallArt(w, h, toneHex) {
  const g = new THREE.Group();
  const frame = rbox(w + 0.08, h + 0.08, 0.04, M.metal);
  g.add(frame);
  // Renderizando a suíte, o quadro saía como um retângulo amarelo
  // estourado — lia como caixa de luz, não como arte. Obra real tem
  // valor MÉDIO, contraste interno e uma área de respiro; e a tela é
  // fosca, não reflete o ambiente.
  const artTex = makeCanvasTexture(256, (ctx, s) => {
    const base = shadeHex(toneHex || '#cfc6b4', 0.62);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    // campo de cor inferior, mais escuro — composição em duas faixas
    ctx.fillStyle = shadeHex(toneHex || '#cfc6b4', 0.34);
    ctx.fillRect(0, s * 0.58, s, s * 0.42);
    // gesto largo atravessando as duas faixas
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = shadeHex(toneHex || '#cfc6b4', 0.2 + Math.random() * 0.28);
      ctx.lineWidth = 6 + Math.random() * 16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const x0 = s * (0.15 + Math.random() * 0.6);
      ctx.moveTo(x0, s * 0.12);
      ctx.quadraticCurveTo(x0 + (Math.random() - 0.5) * s * 0.5, s * 0.5,
                           x0 + (Math.random() - 0.5) * s * 0.4, s * 0.9);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // grão de tela
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 10;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }, 'arte');
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.96, metalness: 0, envMapIntensity: 0.12 }));
  canvas.position.z = 0.025;
  g.add(canvas);
  return g;
}

function createDoorHandle() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 10), M.latao);
  plate.rotation.x = Math.PI / 2; g.add(plate);
  const lever = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.13, 4, 6), M.latao);
  lever.rotation.z = Math.PI / 2;
  lever.position.set(0.08, 0, 0.02);
  g.add(lever);
  return g;
}

function createBaseboardRun(points, h, mat) {
  // points: [[x,z], [x,z], ...] consecutive wall-run corners
  const g = new THREE.Group();
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue;
    const seg = rbox(len, h, 0.02, mat || M.portaEscura);
    seg.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    seg.rotation.y = -Math.atan2(dz, dx);
    g.add(seg);
  }
  return g;
}

function createBookStack(w, count) {
  const g = new THREE.Group();
  let y = 0;
  const tones = [0x8a4a3a, 0x3a4a5a, 0xa08a5a, 0x4a4a42];
  for (let i = 0; i < count; i++) {
    const h = 0.035 + Math.random() * 0.02;
    const bw = w * (0.82 + Math.random() * 0.18);
    const book = rbox(bw, h, w * 0.7, new THREE.MeshStandardMaterial({ color: tones[i % tones.length], roughness: 0.85 }));
    book.position.set((Math.random() - 0.5) * 0.02, y + h / 2, (Math.random() - 0.5) * 0.02);
    book.rotation.y = (Math.random() - 0.5) * 0.1;
    g.add(book);
    y += h;
  }
  return g;
}

function createDecorBowl() {
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.09, 0.08, 16, 1, true), M.vaso);
  bowl.rotation.x = Math.PI;
  bowl.position.y = 0.04;
  bowl.castShadow = true;
  return bowl;
}

function createSofa(w) {
  // Se houver GLB externo para este móvel, ele substitui o procedural.
  if (Assets) { const _m = Assets.model('sofa'); if (_m) {
    const _g = new THREE.Group(); _m.scale.setScalar(w / 2.6); _g.add(_m);
    addContactShadow(_g, 1.6, 1.6, 0.38); return _g; } }
  const g = new THREE.Group();
  addContactShadow(g, w + 0.5, 1.55, 0.42);
  // base recuada (o sofá "flutua" sobre ela, como móvel de designer)
  const plinth = rbox(w - 0.18, 0.12, 0.82, M.tecidoEscuro);
  plinth.position.set(0, 0.16, 0);
  g.add(plinth);
  // estrutura do assento
  const seatBase = rbox(w, 0.20, 0.95, M.tecidoSofa);
  seatBase.position.y = 0.32;
  g.add(seatBase);
  // ALMOFADAS DE ASSENTO independentes, levemente desalinhadas
  const nSeat = Math.max(2, Math.round(w / 0.85));
  for (let i = 0; i < nSeat; i++) {
    const cw = (w - 0.4) / nSeat - 0.03;
    const c = rbox(cw, 0.17, 0.80, M.tecidoSofa);
    c.position.set(-w / 2 + 0.2 + cw / 2 + i * ((w - 0.4) / nSeat), 0.50, 0.02);
    c.rotation.y = (Math.random() - 0.5) * 0.02;
    g.add(c);
  }
  // encosto inclinado + almofadas de encosto
  const back = rbox(w, 0.52, 0.20, M.tecidoSofa);
  back.position.set(0, 0.68, -0.38);
  back.rotation.x = -0.10;
  g.add(back);
  for (let i = 0; i < nSeat; i++) {
    const cw = (w - 0.4) / nSeat - 0.05;
    const c = rbox(cw, 0.40, 0.15, M.tecidoSofa);
    c.position.set(-w / 2 + 0.2 + cw / 2 + i * ((w - 0.4) / nSeat), 0.70, -0.29);
    c.rotation.x = -0.14;
    c.rotation.z = (Math.random() - 0.5) * 0.03;
    g.add(c);
  }
  // braços arredondados, mais baixos que o encosto
  for (const sx of [-w / 2 + 0.11, w / 2 - 0.11]) {
    const arm = rbox(0.22, 0.34, 0.95, M.tecidoSofa);
    arm.position.set(sx, 0.50, 0);
    g.add(arm);
  }
  // almofadas decorativas
  for (let i = 0; i < 2; i++) {
    const p = rbox(0.36, 0.36, 0.11, M.tecidoEscuro);
    p.position.set(-w / 4 + i * (w / 2), 0.66, -0.22);
    p.rotation.z = (Math.random() - 0.5) * 0.4;
    p.rotation.x = -0.2;
    g.add(p);
  }
  return g;
}

function createCoffeeTable(w, d) {
  if (Assets) { const _m = Assets.model('coffee_table'); if (_m) {
    const _g = new THREE.Group(); _m.scale.setScalar(w / 1.30); _g.add(_m); return _g; } }
  const g = new THREE.Group();
  addContactShadow(g, w + 0.35, d + 0.35, 0.32);
  const top = rbox(w, 0.05, d, M.madeiraClara);
  top.position.y = 0.38; g.add(top);
  for (const sx of [-w / 2 + 0.1, w / 2 - 0.1]) {
    for (const sz of [-d / 2 + 0.1, d / 2 - 0.1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.03, 0.36, 10), M.metal);
      leg.position.set(sx, 0.18, sz); leg.castShadow = true; g.add(leg);
    }
  }
  return g;
}

function createChair(matSeat) {
  const g = new THREE.Group();
  const seat = rbox(0.42, 0.05, 0.42, matSeat || M.madeiraClara);
  seat.position.y = 0.46; g.add(seat);
  const back = rbox(0.42, 0.5, 0.05, matSeat || M.madeiraClara);
  back.position.set(0, 0.7, -0.19); g.add(back);
  for (const sx of [-0.17, 0.17]) {
    for (const sz of [-0.17, 0.17]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.03, 0.46, 8), M.metal);
      leg.position.set(sx, 0.23, sz); leg.castShadow = true; g.add(leg);
    }
  }
  return g;
}

function createDiningSet(chairCount, tableW) {
  if (Assets) { const _m = Assets.model('dining_set'); if (_m) {
    const _g = new THREE.Group(); _m.scale.setScalar(tableW / 2.20); _g.add(_m); return _g; } }
  const g = new THREE.Group();
  addContactShadow(g, tableW + 1.1, 2.3, 0.36);
  const top = rbox(tableW, 0.06, 1.1, M.madeiraClara);
  top.position.y = 0.74; g.add(top);
  for (const sx of [-tableW / 2 + 0.12, tableW / 2 - 0.12]) {
    for (const sz of [-0.45, 0.45]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.72, 10), M.metal);
      leg.position.set(sx, 0.36, sz); leg.castShadow = true; g.add(leg);
    }
  }
  const perSide = Math.floor(chairCount / 2);
  for (let i = 0; i < perSide; i++) {
    const cx = -tableW / 2 + (tableW / (perSide + 1)) * (i + 1);
    const c1 = createChair(); c1.position.set(cx, 0, -0.75); g.add(c1);
    const c2 = createChair(); c2.position.set(cx, 0, 0.75); c2.rotation.y = Math.PI; g.add(c2);
  }
  const pendant = createPendantCluster(3);
  pendant.position.set(0, 1.9, 0);
  g.add(pendant);
  return g;
}

function createKitchenIsland(w, d) {
  const g = new THREE.Group();
  addContactShadow(g, w + 0.5, d + 0.5, 0.40);
  const base = rbox(w, 0.85, d, M.estuque);
  base.position.y = 0.42; g.add(base);
  const top = rbox(w + 0.15, 0.06, d + 0.15, M.bancada);
  top.position.y = 0.88; g.add(top);
  for (let i = 1; i < 4; i++) {
    const line = rbox(0.01, 0.7, d - 0.06, M.metal);
    line.position.set(-w / 2 + (w / 4) * i, 0.42, 0);
    g.add(line);
  }
  for (const sx of [w / 2 + 0.35, w / 2 + 0.75]) {
    const stool = createBarStool();
    stool.position.set(sx, 0, d / 2 - 0.15);
    g.add(stool);
  }
  return g;
}

function createBarStool() {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16), M.tecidoEscuro);
  seat.position.y = 0.72; seat.castShadow = true; g.add(seat);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.68, 10), M.metal);
  pole.position.y = 0.38; pole.castShadow = true; g.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 16), M.metal);
  base.position.y = 0.02; g.add(base);
  return g;
}

function createUpperCabinets(w) {
  const g = new THREE.Group();
  const cab = rbox(w, 0.7, 0.32, M.estuque);
  cab.position.y = 1.55; g.add(cab);
  for (let i = 1; i < Math.round(w); i++) {
    const line = rbox(0.01, 0.68, 0.01, M.metal);
    line.position.set(-w / 2 + (w / Math.round(w)) * i, 1.55, 0.16);
    g.add(line);
  }
  return g;
}

function createBed(w) {
  // Se houver GLB externo para este móvel, ele substitui o procedural.
  if (Assets) { const _m = Assets.model('bed'); if (_m) {
    const _g = new THREE.Group(); _m.scale.setScalar(w / 2.0); _g.add(_m);
    addContactShadow(_g, 1.6, 1.6, 0.38); return _g; } }

  // ------------------------------------------------------------
  // CAMA — reconstruída depois de renderizar a suíte
  // A versão anterior era uma pilha de lajes: base em tecido escuro,
  // colchão branco, e um "throw" que era outra laje. Faltava o elemento
  // que faz o olho ler CAMA e não plataforma — o EDREDOM, com a dobra
  // virada na cabeceira. É a dobra que dá maciez e escala.
  //
  // Também: base recuada para o colchão avançar sobre ela (é assim que
  // cama contemporânea se apoia, e cria uma linha de sombra sob o
  // colchão), travesseiros encostados na cabeceira em ângulo, e a manta
  // dos pés dobrada em duas alturas em vez de um bloco.
  // ------------------------------------------------------------
  const g = new THREE.Group();
  addContactShadow(g, w + 0.5, 2.5, 0.40);
  const L = 2.05;

  // base recuada 8 cm de cada lado — o colchão fica em balanço
  const base = rbox(w - 0.16, 0.22, L - 0.16, M.portaEscura);
  base.position.y = 0.11; g.add(base);

  // colchão
  const mattress = rbox(w, 0.26, L, M.roupaCama);
  mattress.position.y = 0.35; g.add(mattress);

  // EDREDOM cobrindo do pé até dois terços da cama
  const duvet = rbox(w + 0.06, 0.14, L * 0.68, M.tecidoSofa);
  duvet.position.set(0, 0.55, L * 0.14); g.add(duvet);

  // dobra virada: faixa mais clara no encontro do edredom com o lençol
  const dobra = rbox(w + 0.07, 0.09, 0.26, M.roupaCama);
  dobra.position.set(0, 0.60, L * 0.14 - L * 0.34 - 0.10); g.add(dobra);

  // caimento lateral do edredom
  for (const sx of [-1, 1]) {
    const lateral = rbox(0.06, 0.20, L * 0.66, M.tecidoSofa);
    lateral.position.set(sx * (w / 2 + 0.02), 0.46, L * 0.14);
    g.add(lateral);
  }

  // cabeceira estofada, mais alta
  const headboard = rbox(w + 0.12, 1.05, 0.12, M.tecidoSofa);
  headboard.position.set(0, 0.72, -L / 2 - 0.04); g.add(headboard);
  // costura horizontal da cabeceira
  const costura = rbox(w + 0.13, 0.02, 0.015, M.portaEscura);
  costura.position.set(0, 0.92, -L / 2 - 0.10); g.add(costura);

  // travesseiros encostados, inclinados
  for (let i = 0; i < 2; i++) {
    const pillow = rbox(0.6, 0.20, 0.42, M.roupaCama);
    pillow.position.set(-w / 4 + i * (w / 2), 0.60, -L / 2 + 0.34);
    pillow.rotation.x = -0.38;
    pillow.rotation.z = (Math.random() - 0.5) * 0.07;
    g.add(pillow);
  }
  // almofadas decorativas menores na frente
  for (let i = 0; i < 2; i++) {
    const deco = rbox(0.34, 0.14, 0.3, M.tecidoEscuro);
    deco.position.set(-0.28 + i * 0.56, 0.60, -L / 2 + 0.62);
    deco.rotation.x = -0.22;
    g.add(deco);
  }

  // manta dos pés, dobrada em dois níveis e caindo pela lateral
  const manta = rbox(w + 0.04, 0.07, 0.46, M.tecidoEscuro);
  manta.position.set(0, 0.63, L * 0.34); g.add(manta);
  const mantaCai = rbox(w + 0.04, 0.26, 0.07, M.tecidoEscuro);
  mantaCai.position.set(0, 0.50, L * 0.34 + 0.22); g.add(mantaCai);

  return g;
}

function createNightstand() {
  const g = new THREE.Group();
  const body = rbox(0.42, 0.5, 0.38, M.madeiraClara);
  body.position.y = 0.25; g.add(body);
  // Abajur com pé, haste e cúpula aberta — antes era a mesma calota
  // fechada da luminária de piso, que renderizava como tigela branca.
  const pe = latheProfile([[0, 0], [0.055, 0], [0.058, 0.012], [0.03, 0.022], [0.012, 0.028]], 16, M.latao);
  pe.position.y = 0.50; g.add(pe);
  const haste = new THREE.Mesh(sharedCyl(0.011, 0.011, 0.20, 10), M.latao);
  haste.position.y = 0.62; g.add(haste);

  const sm = shadeMaterial();
  const cupula = lampShade(0.095, 0.125, 0.155, sm);
  cupula.position.y = 0.79; g.add(cupula);

  const bulb = lampBulb(0.028);
  bulb.position.y = 0.775; g.add(bulb);

  addFixture(g, [0, 0.79, 0], 0xffdca8, sm, 3.0, 'emissive-only');
  emissiveFixtures.push(bulb.material);
  return g;
}

function createBench(w) {
  const g = new THREE.Group();
  addContactShadow(g, w + 0.25, 0.7, 0.32);
  const seat = rbox(w, 0.42, 0.42, M.tecidoEscuro);
  seat.position.y = 0.42; g.add(seat);
  for (const sx of [-w / 2 + 0.1, w / 2 - 0.1]) {
    const leg = rbox(0.06, 0.4, 0.35, M.madeiraClara);
    leg.position.set(sx, 0.2, 0); g.add(leg);
  }
  return g;
}

function createBathtub() {
  const g = new THREE.Group();
  addContactShadow(g, 2.0, 1.1, 0.36);
  const outer = rbox(1.7, 0.55, 0.8, M.banheira);
  outer.position.y = 0.28; g.add(outer);
  const inner = rbox(1.5, 0.32, 0.6, new THREE.MeshStandardMaterial({ color: 0xdfe9ec, roughness: 0.1 }));
  inner.position.y = 0.46; g.add(inner);
  const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), M.latao);
  faucet.position.set(0, 0.66, -0.36); g.add(faucet);
  return g;
}

function createVanity(w) {
  const g = new THREE.Group();
  const cab = rbox(w, 0.68, 0.5, M.madeiraClara);
  cab.position.y = 0.34; g.add(cab);
  const top = rbox(w + 0.06, 0.05, 0.54, M.bancada);
  top.position.y = 0.7; g.add(top);
  for (const sx of [-w / 4, w / 4]) {
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.1, 20), M.banheira);
    basin.position.set(sx, 0.75, 0); basin.castShadow = true; g.add(basin);
    const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.24, 8), M.latao);
    faucet.position.set(sx, 0.92, -0.18); g.add(faucet);
    const mirror = rbox(0.5, 0.7, 0.02, new THREE.MeshStandardMaterial({ color: 0xdfe9ee, roughness: 0.05, metalness: 0.6 }));
    mirror.position.set(sx, 1.5, -0.24); g.add(mirror);
  }
  return g;
}

function createRug(w, d) {
  // Era um PlaneGeometry de espessura ZERO. Sem borda e sem aresta, o
  // olho não tem como separar "tapete" de "trecho de piso pintado de
  // outra cor" — foi assim que ele leu em todos os renders de interior.
  // 1,8 cm dá a aresta lateral e a sombrinha de contato que dizem
  // "objeto pousado no chão". O centro afunda 9 mm no piso, o que não
  // aparece e ainda evita z-fighting com a laje.
  const rug = rbox(w, 0.018, d, M.tapete, false);
  rug.receiveShadow = true;
  return rug;
}

function createPendantCluster(n) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), M.metal);
    wire.position.set((i - (n - 1) / 2) * 0.4, 0.25, 0);
    g.add(wire);
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0xb08d57, roughness: 0.3, metalness: 0.9,
      emissive: 0xffdca8, emissiveIntensity: 0,
    });
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 6), shadeMat);
    shade.position.set((i - (n - 1) / 2) * 0.4, 0, 0);
    shade.castShadow = false;
    g.add(shade);
    // apenas o pendente central recebe luz real; os demais só brilham
    addFixture(g, [(i - (n - 1) / 2) * 0.4, -0.06, 0], 0xffdca8, shadeMat, 3.2,
               i === Math.floor(n / 2) ? 'normal' : 'emissive-only');
  }
  return g;
}

// Cúpula de abajur: cilindro ABERTO nas duas pontas, com DoubleSide.
//
// As duas luminárias da casa usavam latheProfile com um perfil que nunca
// volta ao eixo — uma calota FECHADA. De fora só existe a superfície
// externa, e o resultado renderizado era literalmente uma tigela branca
// pousada no móvel: sem lâmpada, sem interior, sem leitura de luminária.
//
// O que faz o olho reconhecer um abajur é ver a face INTERNA da cúpula,
// mais clara que a externa, e a lâmpada dentro. Cilindro aberto entrega
// as duas coisas por um punhado de triângulos.
function lampShade(rTop, rBot, h, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 20, 1, true), mat);
  // Cúpula aberta projeta sombra incoerente (a "tampa" não existe), e é
  // fina o bastante para a sombra não fazer falta.
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

function shadeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xf1e6d2, roughness: 0.92, metalness: 0,
    emissive: 0xffdca8, emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });
}

// Lâmpada visível pela boca da cúpula. De dia é uma esfera fosca pequena;
// à noite é o ponto quente que denuncia que a luminária está acesa.
function lampBulb(r) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfff4e0, roughness: 0.35, metalness: 0,
    emissive: 0xffe6bc, emissiveIntensity: 0, envMapIntensity: 0.2,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.castShadow = false;
  return m;
}

function createFloorLamp() {
  if (Assets) { const _m = Assets.model('lamp'); if (_m) {
    const _g = new THREE.Group(); _m.scale.setScalar(1); _g.add(_m); return _g; } }
  const g = new THREE.Group();
  const pole = new THREE.Mesh(sharedCyl(0.016, 0.016, 1.44, 10), M.latao);
  pole.position.y = 0.72; g.add(pole);
  // base em disco torneado: dá peso visual ao pé e evita a haste nascendo
  // do chão sem apoio
  const base = latheProfile([[0, 0], [0.15, 0], [0.155, 0.012], [0.09, 0.026], [0.02, 0.03]], 20, M.latao);
  g.add(base);

  const sm = shadeMaterial();
  const shade = lampShade(0.185, 0.215, 0.26, sm);
  shade.position.y = 1.44; g.add(shade);
  // aro superior, para a boca da cúpula não terminar numa aresta de papel
  const aro = new THREE.Mesh(sharedCyl(0.186, 0.186, 0.012, 20), M.latao);
  aro.position.y = 1.566; aro.castShadow = false; g.add(aro);

  const bulb = lampBulb(0.045);
  bulb.position.y = 1.44; g.add(bulb);

  addFixture(g, [0, 1.44, 0], 0xffdca8, sm, 3.6);
  emissiveFixtures.push(bulb.material);
  return g;
}

function createDesk() {
  const g = new THREE.Group();
  addContactShadow(g, 1.6, 1.4, 0.32);
  const top = rbox(1.3, 0.05, 0.6, M.madeiraClara);
  top.position.y = 0.74; g.add(top);
  for (const sx of [-0.58, 0.58]) {
    const leg = rbox(0.05, 0.72, 0.5, M.metal);
    leg.position.set(sx, 0.36, 0); g.add(leg);
  }
  const chair = createChair(M.tecidoEscuro);
  chair.position.set(0, 0, 0.55);
  chair.rotation.y = Math.PI;
  g.add(chair);
  return g;
}

function createOutdoorLounger() {
  // Se houver GLB externo para este móvel, ele substitui o procedural.
  if (Assets) { const _m = Assets.model('lounger'); if (_m) {
    const _g = new THREE.Group(); _m.scale.setScalar(1); _g.add(_m);
    addContactShadow(_g, 1.6, 1.6, 0.38); return _g; } }

  // ------------------------------------------------------------
  // ESPREGUIÇADEIRA — perfil extrudado, não caixas empilhadas
  // A versão anterior era uma laje plana + um encosto inclinado solto +
  // 4 pés. Espreguiçadeira de verdade tem um colchão CONTÍNUO que sobe
  // do assento para o encosto passando por uma quebra no joelho — é
  // esse perfil que o olho reconhece, e ele não sai de caixas soltas.
  //
  // ExtrudeGeometry com bevel resolve exatamente isso: desenha-se o
  // perfil de lado e ele é varrido pela largura, já com aresta
  // arredondada. Mesma técnica que a modelagem em SketchUp usaria, sem
  // trazer malha externa e mantendo os materiais do projeto.
  // ------------------------------------------------------------
  const g = new THREE.Group();
  addContactShadow(g, 0.95, 2.3, 0.34);

  const W = 0.68;          // largura
  const perfil = new THREE.Shape();
  // (z = comprimento, y = altura), do pé para a cabeceira
  perfil.moveTo(-0.98, 0.30);
  perfil.lineTo(0.12, 0.30);
  perfil.quadraticCurveTo(0.30, 0.32, 0.42, 0.44);   // quebra do joelho
  perfil.lineTo(0.94, 0.86);                          // encosto reclinado
  perfil.quadraticCurveTo(1.02, 0.92, 0.98, 0.99);
  perfil.lineTo(0.90, 1.03);
  perfil.quadraticCurveTo(0.84, 1.05, 0.80, 1.01);
  perfil.lineTo(0.32, 0.56);
  perfil.quadraticCurveTo(0.22, 0.47, 0.10, 0.46);
  perfil.lineTo(-0.98, 0.46);
  perfil.quadraticCurveTo(-1.05, 0.46, -1.05, 0.38);
  perfil.quadraticCurveTo(-1.05, 0.30, -0.98, 0.30);

  const colchao = new THREE.Mesh(
    new THREE.ExtrudeGeometry(perfil, {
      depth: W, bevelEnabled: true,
      bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2,
      curveSegments: 5,
    }),
    M.tecidoSofa
  );
  // ExtrudeGeometry varre em +Z; o perfil foi desenhado em (z, y), então
  // rotaciona para a varredura virar a LARGURA da peça.
  colchao.rotation.y = Math.PI / 2;
  colchao.position.set(-W / 2, 0, 0);
  colchao.castShadow = true; colchao.receiveShadow = true;
  g.add(colchao);

  // Costura longitudinal: divide o colchão em duas almofadas, que é como
  // estofado de área externa realmente é feito.
  const costura = rbox(0.012, 0.02, 1.9, M.tecidoEscuro);
  costura.position.set(0, 0.47, -0.1);
  g.add(costura);

  // Estrutura em ipê aparecendo por baixo do colchão
  for (const sx of [-0.30, 0.30]) {
    const rail = rbox(0.05, 0.09, 2.0, M.ipe);
    rail.position.set(sx, 0.26, -0.02);
    g.add(rail);
  }
  const travessa = rbox(0.62, 0.05, 0.05, M.ipe);
  travessa.position.set(0, 0.26, 0.86);
  g.add(travessa);

  // Pés: dois na frente, e atrás uma roda — detalhe que denuncia móvel
  // de piscina de verdade.
  for (const sx of [-0.28, 0.28]) {
    const leg = rbox(0.04, 0.22, 0.04, M.metal);
    leg.position.set(sx, 0.11, -0.82);
    g.add(leg);
    const legB = rbox(0.04, 0.20, 0.04, M.metal);
    legB.position.set(sx, 0.12, 0.30);
    g.add(legB);
    const roda = new THREE.Mesh(sharedCyl(0.07, 0.07, 0.03, 14), M.metal);
    roda.rotation.z = Math.PI / 2;
    roda.position.set(sx, 0.07, 0.86);
    roda.castShadow = true;
    g.add(roda);
  }
  return g;
}

function createPottedPlant(scale) {
  if (Assets) { const _m = Assets.model('plant'); if (_m) {
    const _g = new THREE.Group(); _m.scale.setScalar(scale || 1); _g.add(_m); return _g; } }
  const g = new THREE.Group();
  addContactShadow(g, 0.62 * (scale || 1), 0.62 * (scale || 1), 0.38);
  const s = scale || 1;
  // vaso com barriga e boca — perfil torneado, não cilindro
  const pot = latheProfile([
    [0.15*s,0],[0.20*s,0.06*s],[0.235*s,0.16*s],[0.215*s,0.28*s],[0.225*s,0.32*s],[0.205*s,0.325*s]
  ], 18, M.vaso);
  g.add(pot);
  const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 * s, 0), M.copaArvore2);
  foliage.position.y = 0.75 * s; foliage.castShadow = true; g.add(foliage);
  return g;
}

// ============================================================
// DETALHES — objetos que a auditoria de "casa real" apontou como
// ausentes. Regra aplicada: detalhar só o que a câmera realmente vê.
// ============================================================

// --- SALA: painel de TV + televisão + rack ---
function createTVWall(w) {
  const g = new THREE.Group();
  const panel = rbox(w, 2.4, 0.09, M.cumaru);
  panel.position.y = 1.2;
  g.add(panel);

  // TV: moldura fina escura + tela levemente emissiva (lê como TV mesmo
  // desligada, e acende de leve à noite)
  const frame = rbox(1.72, 0.99, 0.05, M.metal);
  frame.position.set(0, 1.55, 0.07);
  g.add(frame);
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d10, roughness: 0.18, metalness: 0.35,
    emissive: 0x0a1622, emissiveIntensity: 0.25,
  });
  const screen = rbox(1.66, 0.93, 0.02, screenMat, false);
  screen.position.set(0, 1.55, 0.10);
  g.add(screen);
  g.userData.screenMat = screenMat;

  // rack suspenso
  const rack = rbox(2.3, 0.34, 0.42, M.madeiraClara);
  rack.position.set(0, 0.62, 0.21);
  g.add(rack);
  const rackLine = rbox(2.3, 0.012, 0.01, M.metal);
  rackLine.position.set(0, 0.62, 0.42);
  g.add(rackLine);

  // luz indireta atrás do painel (cove) — dá profundidade à parede
  addFixture(g, [0, 2.3, 0.35], 0xffd9a8, screenMat, 4.5, 'emissive-only');

  const bowl = createDecorBowl();
  bowl.position.set(-0.8, 0.79, 0.21);
  g.add(bowl);
  const bk = createBookStack(0.26, 3);
  bk.position.set(0.75, 0.79, 0.21);
  g.add(bk);
  return g;
}

// --- Poltrona (silhueta diferente do sofá, pés cônicos) ---
function createArmchair() {
  const g = new THREE.Group();
  const seat = rbox(0.78, 0.36, 0.78, M.tecidoEscuro);
  seat.position.y = 0.36; g.add(seat);
  const back = rbox(0.78, 0.62, 0.16, M.tecidoEscuro);
  back.position.set(0, 0.72, -0.31);
  back.rotation.x = -0.10;
  g.add(back);
  for (const sx of [-0.35, 0.35]) {
    const arm = rbox(0.1, 0.24, 0.72, M.tecidoEscuro);
    arm.position.set(sx, 0.5, 0.02); g.add(arm);
  }
  for (const sx of [-0.3, 0.3]) for (const sz of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.03, 0.2, 8), M.madeiraClara);
    leg.position.set(sx, 0.1, sz); leg.castShadow = true; g.add(leg);
  }
  const cushion = rbox(0.62, 0.12, 0.58, M.tecidoSofa);
  cushion.position.set(0, 0.56, 0.02);
  g.add(cushion);
  return g;
}

// --- Cortinas: painéis verticais leves junto ao vidro ---
function createCurtainRun(width, height, panels, mat) {
  const g = new THREE.Group();
  const sheer = mat || new THREE.MeshStandardMaterial({
    color: 0xefe7d8, roughness: 1.0, metalness: 0,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  });
  const pw = width / panels;
  for (let i = 0; i < panels; i++) {
    // leve variação de largura/rotação = tecido, não placa
    const w = pw * (0.86 + Math.random() * 0.2);
    const p = rbox(w, height, 0.03, sheer, false);
    p.position.set(-width / 2 + pw * (i + 0.5), height / 2, (Math.random() - 0.5) * 0.04);
    p.rotation.y = (Math.random() - 0.5) * 0.09;
    g.add(p);
  }
  const rod = rbox(width, 0.03, 0.03, M.metal);
  rod.position.y = height + 0.02;
  g.add(rod);
  return g;
}

// --- COZINHA: cooktop, coifa, geladeira, cuba, torneira ---
function createCooktop() {
  const g = new THREE.Group();
  const plate = rbox(0.76, 0.02, 0.48, new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.15, metalness: 0.4 }), false);
  g.add(plate);
  for (const [bx, bz] of [[-0.19, -0.12], [0.19, -0.12], [-0.19, 0.12], [0.19, 0.12]]) {
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.006, 14), M.metal);
    burner.position.set(bx, 0.014, bz);
    g.add(burner);
  }
  return g;
}

function createHood(w) {
  const g = new THREE.Group();
  const body = rbox(w, 0.16, 0.55, M.metal);
  body.position.y = 0.08; g.add(body);
  const duct = rbox(0.26, 0.62, 0.24, M.metal);
  duct.position.y = 0.47; g.add(duct);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xfff4e2, roughness: 0.85, emissive: 0xfff0d2, emissiveIntensity: 0,
  });
  const panel = rbox(w * 0.8, 0.01, 0.42, glowMat, false);
  panel.position.y = -0.005;
  g.add(panel);
  addFixture(g, [0, -0.05, 0], 0xfff0d2, glowMat, 2.8, 'emissive-only');
  return g;
}

function createFridge() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.28, metalness: 0.75 });
  const body = rbox(0.9, 1.95, 0.68, mat);
  body.position.y = 0.975; g.add(body);
  // fenda entre as duas portas + puxadores verticais
  const split = rbox(0.012, 1.9, 0.01, new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6 }), false);
  split.position.set(0, 0.975, 0.345); g.add(split);
  for (const hx of [-0.07, 0.07]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 8), M.metal);
    h.position.set(hx, 1.2, 0.36); h.castShadow = true; g.add(h);
  }
  return g;
}

function createSinkAndTap() {
  const g = new THREE.Group();
  const basin = rbox(0.58, 0.02, 0.4, new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.2, metalness: 0.8 }), false);
  g.add(basin);
  const rim = rbox(0.62, 0.015, 0.44, M.metal, false);
  rim.position.y = 0.012; g.add(rim);
  const tapBase = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.3, 10), M.metal);
  tapBase.position.set(0, 0.15, -0.24); tapBase.castShadow = true; g.add(tapBase);
  const tapArm = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.24, 10), M.metal);
  tapArm.rotation.x = Math.PI / 2;
  tapArm.position.set(0, 0.29, -0.13); g.add(tapArm);
  return g;
}

function createBacksplash(w, h) {
  const p = rbox(w, h, 0.02, M.bancada, false);
  return p;
}

// --- BANHEIRO: box de vidro, toalhas, nicho ---
function createShowerEnclosure(w, d, h) {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xdCEAF0, roughness: 0.03, metalness: 0, transmission: 0.82,
    thickness: 0.02, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
  });
  const front = rbox(w, h, 0.02, glass, false);
  front.position.set(0, h / 2, d / 2); g.add(front);
  const side = rbox(0.02, h, d, glass, false);
  side.position.set(w / 2, h / 2, 0); g.add(side);
  // perfis metálicos
  for (const [px, py, pz, pw, ph, pd] of [
    [0, h, d / 2, w, 0.03, 0.03], [w / 2, h, 0, 0.03, 0.03, d],
    [w / 2, h / 2, d / 2, 0.03, h, 0.03],
  ]) { const bar = rbox(pw, ph, pd, M.metal); bar.position.set(px, py, pz); g.add(bar); }
  // chuveiro de teto + ralo linear
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 16), M.metal);
  head.position.set(0, h - 0.12, -d * 0.15); head.castShadow = true; g.add(head);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), M.metal);
  arm.position.set(0, h - 0.02, -d * 0.15); g.add(arm);
  const drain = rbox(w * 0.7, 0.008, 0.05, M.metal, false);
  drain.position.set(0, 0.005, d * 0.28); g.add(drain);
  return g;
}

function createTowelStack() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf0ebe0, roughness: 1.0 });
  for (let i = 0; i < 3; i++) {
    const t = rbox(0.34, 0.07, 0.24, mat);
    t.position.set((Math.random() - 0.5) * 0.012, 0.035 + i * 0.072, 0);
    t.rotation.y = (Math.random() - 0.5) * 0.05;
    g.add(t);
  }
  return g;
}

function createNiche(w, h, d) {
  const g = new THREE.Group();
  const back = rbox(w, h, 0.02, M.bancada, false);
  back.position.z = -d / 2; g.add(back);
  back.material = new THREE.MeshStandardMaterial({
    color: 0xf2efe9, roughness: 0.35, emissive: 0xffe4bb, emissiveIntensity: 0,
  });
  addFixture(g, [0, h / 2 - 0.06, 0], 0xffe4bb, back.material, 2.2, 'emissive-only');
  return g;
}

// --- SUÍTE / ESCRITÓRIO: armário, prateleira, monitor ---
function createWardrobe(w, h) {
  const g = new THREE.Group();
  const body = rbox(w, h, 0.6, M.madeiraClara);
  body.position.y = h / 2; g.add(body);
  const doors = Math.max(2, Math.round(w / 0.6));
  for (let i = 1; i < doors; i++) {
    const line = rbox(0.012, h - 0.06, 0.012, M.metal, false);
    line.position.set(-w / 2 + (w / doors) * i, h / 2, 0.3);
    g.add(line);
  }
  for (let i = 0; i < doors; i++) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.28, 8), M.metal);
    handle.position.set(-w / 2 + (w / doors) * (i + 0.5) + 0.12, h * 0.55, 0.31);
    handle.castShadow = true;
    g.add(handle);
  }
  return g;
}

function createShelfUnit(w, shelves) {
  const g = new THREE.Group();
  for (let i = 0; i < shelves; i++) {
    const s = rbox(w, 0.04, 0.28, M.madeiraClara);
    s.position.y = 0.42 * i;
    g.add(s);
    if (i > 0 && Math.random() > 0.35) {
      const bk = createBookStack(0.22, 2 + Math.floor(Math.random() * 3));
      bk.position.set(-w / 2 + 0.2 + Math.random() * (w - 0.4), 0.42 * i + 0.02, 0);
      bk.rotation.y = Math.PI / 2;
      g.add(bk);
    }
  }
  return g;
}

function createMonitor() {
  const g = new THREE.Group();
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0d1014, roughness: 0.2, metalness: 0.3,
    emissive: 0x16283a, emissiveIntensity: 0.3,
  });
  const screen = rbox(0.62, 0.37, 0.02, screenMat, false);
  screen.position.y = 0.42; g.add(screen);
  const bezel = rbox(0.66, 0.41, 0.015, M.metal);
  bezel.position.set(0, 0.42, -0.012); g.add(bezel);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), M.metal);
  neck.position.y = 0.13; neck.castShadow = true; g.add(neck);
  const foot = rbox(0.26, 0.015, 0.16, M.metal);
  foot.position.y = 0.03; g.add(foot);
  g.userData.screenMat = screenMat;
  return g;
}

// --- Iluminação indireta linear (cove) — luz com função, não point light solta ---
//
// ACHADO RENDERIZANDO: de dia, os quatro coves apareciam como uma RISCA
// BRANCA DURA atravessando a parede. Não era brilho: de dia s.lamp é 0 e
// emissiveIntensity também, então a fita não estava acesa. Era só uma
// barra branca de 3 cm exposta na parede, iluminada como qualquer objeto.
// Ler aquilo como "bloom exagerado" teria levado a mexer no bloom, que
// não tinha nada a ver.
//
// O erro é de modelagem, não de luz: cove de verdade fica DENTRO de um
// rasgo, atrás de uma testeira. Ninguém vê o diodo — vê o degradê que ele
// joga na parede. Agora a geometria é a do detalhe construtivo:
//
//        parede
//        |
//        |####  <- fita, recuada e virada para cima
//        |    \
//        |     ] testeira: esconde a fita de quem está no ambiente
//
function createCoveLight(len, color, fasciaMat) {
  const g = new THREE.Group();
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0xfff1d8, emissive: 0xffdca8, emissiveIntensity: 0.0, roughness: 0.9,
    // A fita não pode reagir ao céu: era isso que a deixava branca de dia.
    // Ela só existe visualmente quando está acesa.
    envMapIntensity: 0.0,
  });
  const strip = rbox(len, 0.02, 0.03, stripMat, false);
  strip.position.set(0, 0, -0.035);
  g.add(strip);
  g.userData.strip = stripMat;

  // Testeira: 9 cm de aba na frente e abaixo da fita. É ela que faz a luz
  // sair só para cima e que tapa o diodo na altura do olho.
  const fascia = rbox(len, 0.09, 0.022, fasciaMat || M.estuque, false);
  fascia.position.set(0, -0.012, 0.028);
  fascia.receiveShadow = true;
  g.add(fascia);

  // Fundo do rasgo, para o vão não vazar para dentro da parede.
  const back = rbox(len, 0.11, 0.02, fasciaMat || M.estuque, false);
  back.position.set(0, 0.005, -0.062);
  g.add(back);

  // Antes: uma PointLight a cada 2,2 m de cove — sozinhas somavam mais de
  // uma dezena de luzes. Agora a fita emissiva faz o trabalho visual e no
  // máximo UMA luz real é criada, se houver orçamento. A luz sobe (+y),
  // que é para onde o rasgo aponta.
  addFixture(g, [0, 0.10, -0.03], color || 0xffd9a8, stripMat, Math.max(4, len * 0.7));
  return g;
}

// createGrassTuft() e createShrub() viviam aqui: tufos de caixas e lobos
// de icosaedro, um Group por planta. Foram substituídos por emitGrassTuft()
// e emitShrub(), que empurram cartões de folha com alphaTest para dentro de
// um buffer instanciado — mesma leitura visual, sem centenas de draw calls.
// As versões antigas ficaram para trás sem nenhuma chamada; em arquivo
// único, código morto é peso que o usuário baixa.

// ============================================================
// INTERIOR
// Cada função devolve o grupo da sala para que os hotspots/câmeras de
// capítulo possam referenciar posições reais dentro dela.
// ============================================================
function collectLamps(group) {
  group.traverse((o) => {
    if (o.userData && o.userData.lamp) lampLights.push(o.userData.lamp);
    if (o.userData) {
      Object.keys(o.userData).forEach(k => {
        if (k.startsWith('lamp') && o.userData[k] && o.userData[k].isLight) lampLights.push(o.userData[k]);
      });
    }
  });
}

function buildLivingRoom() {
  const g = new THREE.Group();
  const rug = createRug(4.4, 3.4);
  rug.position.set(-8.4, 0.125, 0.2);
  g.add(rug);

  const sofa = createSofa(2.6);
  sofa.position.set(-8.6, 0.12, -1.6);
  g.add(sofa);

  // Painel de TV na parede norte, de frente para o sofá — resolve a
  // parede vazia e dá função ao eixo do estar.
  const tv = createTVWall(3.2);
  tv.position.set(-8.6, 0.12, -5.94);
  g.add(tv);
  collectLamps(tv);

  // Duas poltronas fechando a composição (antes o sofá conversava com
  // o nada). Ângulo levemente aberto para a piscina.
  const ac1 = createArmchair();
  ac1.position.set(-10.5, 0.12, 0.9);
  ac1.rotation.y = 0.85;
  g.add(ac1);
  const ac2 = createArmchair();
  ac2.position.set(-6.7, 0.12, 0.9);
  ac2.rotation.y = -0.85;
  g.add(ac2);

  const table = createCoffeeTable(1.3, 0.7);
  table.position.set(-8.6, 0.12, -0.3);
  g.add(table);

  const lamp = createFloorLamp();
  lamp.position.set(-10.7, 0.12, -2.8);
  g.add(lamp);
  collectLamps(lamp);

  const plant = createPottedPlant(1.15);
  plant.position.set(-10.6, 0.12, 3.2);
  g.add(plant);

  // Cortinas junto à fachada de vidro sul — suavizam a superfície dura
  // do vidro e dão a leitura de "ambiente habitado".
  const curtains = createCurtainRun(5.0, 2.9, 7);
  curtains.position.set(-9.4, 0.12, 5.78);
  g.add(curtains);

  // Iluminação de cove no encontro parede/teto
  const cove = createCoveLight(5.6, 0xffd9a8);
  cove.position.set(-8.4, 3.02, -5.7);
  g.add(cove);
  collectLamps(cove);

  const art = createWallArt(1.1, 0.78, '#c7bca3');
  art.position.set(-11.05, 1.85, -2.6);
  art.rotation.y = Math.PI / 2;
  g.add(art);

  const books = createBookStack(0.32, 4);
  books.position.set(-9.0, 0.38, -0.1);
  books.rotation.y = 0.3;
  g.add(books);
  const bowl = createDecorBowl();
  bowl.position.set(-8.2, 0.38, -0.45);
  g.add(bowl);

  // O rodapé que existia aqui — uma corrida só, na parede norte — foi
  // substituído pelo pacote de acabamento em `buildInteriorTrim()`, que
  // cobre TODAS as paredes internas e usa junta de sombra em vez de
  // rodapé saliente. Mantê-lo aqui deixaria uma peça de madeira de 9 cm
  // brigando com a junta de 4 cm na mesma parede.

  houseGroup.add(g);
  return g;
}

// ============================================================
// ACABAMENTO INTERNO — a parte que separa render de projeto
// ------------------------------------------------------------
// Antes daqui as paredes internas encontravam o piso e o teto em aresta
// viva, sem nenhuma peça de transição. É o que faz um interior 3D ler
// como "caixa branca" mesmo com bons móveis: no mundo real nenhuma
// parede toca o piso sem rodapé, junta ou reserva.
//
// O registro é o pedido — contemporâneo/futurista — então NÃO é rodapé
// de madeira saliente:
//
//  - no piso, JUNTA DE SOMBRA: uma reentrância escura de 4 cm, embutida
//    1,5 cm na parede. É o detalhe que estúdio de alto padrão usa
//    justamente para a parede parecer que flutua;
//  - no teto, SANCA COM LED LINEAR: uma reserva com uma fita emissiva
//    que acende ao anoitecer.
//
// A fita entra em `emissiveFixtures`, que é a lista que `applySolarTime`
// já rampeia junto com as luminárias. Um material só para todas as
// corridas — assim a casa inteira acende no MESMO instante, que é como
// uma instalação de LED se comporta. Com um material por trecho, o
// escalonamento por índice acenderia a sala antes do corredor.
//
// Custo: emissivo não é luz. Não entra no orçamento de luzes, não
// projeta sombra e não avalia BRDF nenhum — é cor somada no fragmento.
//
// AS COORDENADAS SÃO LIDAS, NÃO CHUTADAS. Numa passada anterior eu
// deixei este item pela metade dizendo que não sabia onde ficavam as
// aberturas. As paredes estão em `buildArchitecture`:
//
//   social norte    z = -6,10  x de -11,25 a  2,95   (sólida)
//   social oeste    x = -11,10 z de  -6,10 a  6,10   (janela em y 1,0-2,6)
//   suíte norte     z = -6,10  x de   3,90 a 12,10   (sólida)
//   suíte leste     x =  12,10 z de  -6,10 a  6,10   (janela em y 1,0-2,6)
//   partição        x =   9,30 z de  -5,00 a  3,00
//
// As janelas oeste e leste começam a 1 m do piso, então a junta passa
// INTEIRA por baixo delas — era exatamente isso que eu não sabia. Onde a
// vedação é vidro do piso ao teto (fachada sul, z = 6,0) não há corrida
// nenhuma: ali quem faz a transição é a soleira de concreto que já
// existe (`socialSill`).
const TRIM_Y_TETO = 3.06;      // abaixo da laje em 3,2
const TRIM_LED = 0.035;

function buildInteriorTrim() {
  const g = new THREE.Group();

  // Reentrância escura e fosca: ela existe para NÃO ser notada como peça,
  // só como sombra. Qualquer brilho aqui denuncia que é um objeto.
  const matJunta = new THREE.MeshStandardMaterial({
    color: 0x16171a, roughness: 0.95, metalness: 0, envMapIntensity: 0.15,
  });
  // A sanca é clara: ela recebe o quique da fita e devolve para o teto.
  const matSanca = new THREE.MeshStandardMaterial({
    color: 0xe8e4dc, roughness: 0.9, metalness: 0, envMapIntensity: 0.25,
  });
  const matLed = new THREE.MeshStandardMaterial({
    color: 0xfff1d8, roughness: 1, metalness: 0,
    emissive: 0xffdca8, emissiveIntensity: 0,
  });
  // Nome para poder achá-lo por travessia e desligá-lo em tempo de
  // execução. Sem isso, "a sanca estourou a sala?" só se responde
  // rebuildando — e a resposta chega junto com todo o resto que mudou.
  matLed.name = 'casaAura_led_sanca';
  emissiveFixtures.push(matLed);

  // [x0, z0, x1, z1, nx, nz] — n aponta PARA DENTRO do cômodo, e é ele
  // que decide para que lado a junta recua e a sanca avança.
  const CORRIDAS = [
    // ala social
    [-10.99, -5.99,   2.60, -5.99,  0,  1],   // norte
    [-10.99, -5.99, -10.99,  5.90,  1,  0],   // oeste (janela alta, não corta)
    [  2.60, -5.99,   2.60,  1.00, -1,  0],   // face oeste do núcleo de pedra
    // suíte
    [  4.25, -5.99,  11.99, -5.99,  0,  1],   // norte
    [ 11.99, -5.99,  11.99,  5.90, -1,  0],   // leste (janela alta)
    [  9.21, -5.00,   9.21,  3.00, -1,  0],   // partição, face do quarto
    [  9.39, -5.00,   9.39,  3.00,  1,  0],   // partição, face do banho
  ];

  for (const [x0, z0, x1, z1, nx, nz] of CORRIDAS) {
    const dx = x1 - x0, dz = z1 - z0;
    const comp = Math.hypot(dx, dz);
    if (comp < 0.05) continue;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const rot = -Math.atan2(dz, dx);

    // junta de sombra: recuada 1,5 cm PARA DENTRO da parede
    const junta = box(comp, 0.04, 0.03, matJunta, false);
    junta.position.set(cx - nx * 0.015, 0.09, cz - nz * 0.015);
    junta.rotation.y = rot;
    g.add(junta);

    // sanca: avança 6 cm para dentro do cômodo
    const sanca = box(comp, 0.10, 0.12, matSanca, false);
    sanca.position.set(cx + nx * 0.06, TRIM_Y_TETO, cz + nz * 0.06);
    sanca.rotation.y = rot;
    g.add(sanca);

    // fita de LED, escondida sob a aba da sanca e voltada para o teto
    const led = box(comp - 0.04, TRIM_LED, 0.02, matLed, false);
    led.position.set(cx + nx * 0.035, TRIM_Y_TETO + 0.07, cz + nz * 0.035);
    led.rotation.y = rot;
    g.add(led);
  }

  houseGroup.add(g);
  return g;
}

function buildDining() {
  const g = new THREE.Group();
  const set = createDiningSet(6, 2.2);
  set.position.set(-4.5, 0.12, 0.2);
  g.add(set);
  collectLamps(set);
  houseGroup.add(g);
  return g;
}

function buildKitchen() {
  const g = new THREE.Group();
  const island = createKitchenIsland(2.3, 1.05);
  island.position.set(0.4, 0.12, 0.9);
  g.add(island);

  // Cooktop embutido na ilha + coifa alinhada acima. Isso é o que faz
  // ler como cozinha em vez de bancada genérica.
  const cooktop = createCooktop();
  cooktop.position.set(0.4, 1.01, 0.9);
  g.add(cooktop);
  const hood = createHood(1.0);
  hood.position.set(0.4, 2.05, 0.9);
  g.add(hood);
  collectLamps(hood);

  const cabinets = createUpperCabinets(3.6);
  cabinets.position.set(0.6, 0.12, -5.75);
  g.add(cabinets);

  const counter = box(3.6, 0.85, 0.62, M.estuque);
  counter.position.set(0.6, 0.55, -5.75);
  g.add(counter);
  const counterTop = box(3.7, 0.06, 0.68, M.bancada);
  counterTop.position.set(0.6, 0.98, -5.75);
  g.add(counterTop);

  // Revestimento entre bancada e armários (antes: parede nua)
  const splash = createBacksplash(3.6, 0.58);
  splash.position.set(0.6, 1.3, -6.06);
  g.add(splash);

  // Cuba + torneira na bancada da parede
  const sink = createSinkAndTap();
  sink.position.set(-0.3, 1.01, -5.75);
  g.add(sink);

  // Geladeira embutida na ponta da bancada
  const fridge = createFridge();
  fridge.position.set(2.75, 0.12, -5.78);
  g.add(fridge);

  // Objetos de bancada. Bancada de pedra impecável e completamente vazia
  // lê como showroom, não como cozinha de uma casa habitada — que é a
  // leitura que a experiência precisa provocar.
  const fruteira = createDecorBowl();
  fruteira.position.set(1.35, 1.02, 0.75);
  g.add(fruteira);

  const tabua = box(0.42, 0.028, 0.28, M.madeiraClara);
  tabua.position.set(-0.62, 1.02, 1.05);
  tabua.rotation.y = -0.22;
  g.add(tabua);

  // Potes de mantimento junto ao backsplash, alturas alternadas
  [[-0.95, 0.14, 0.075], [-0.72, 0.19, 0.062], [-0.52, 0.11, 0.055]].forEach(([px, ph, pr]) => {
    const pote = new THREE.Mesh(sharedCyl(pr, pr, ph, 14), M.bancada);
    pote.position.set(px, 1.01 + ph / 2, -5.88);
    pote.castShadow = true; pote.receiveShadow = true;
    g.add(pote);
    const tampa = new THREE.Mesh(sharedCyl(pr * 1.05, pr * 1.05, 0.018, 14), M.madeiraClara);
    tampa.position.set(px, 1.01 + ph + 0.009, -5.88);
    tampa.castShadow = true;
    g.add(tampa);
  });

  // Pano de prato dobrado sobre a borda da bancada — o detalhe pequeno
  // que denuncia uso
  const pano = box(0.22, 0.16, 0.012, M.roupaCama);
  pano.position.set(1.9, 0.92, -5.44);
  g.add(pano);

  // Luz de trabalho sob os armários — luminotécnica real de cozinha
  const taskLight = createCoveLight(3.4, 0xfff0d2);
  taskLight.position.set(0.6, 1.18, -5.5);
  g.add(taskLight);
  collectLamps(taskLight);

  for (let i = 0; i < 2; i++) {
    const pendant = createPendantCluster(1);
    pendant.position.set(-0.4 + i * 1.6, 1.62, 0.9);
    g.add(pendant);
    collectLamps(pendant);
  }

  houseGroup.add(g);
  return g;
}

function buildPrimarySuite() {
  const g = new THREE.Group();

  // parede de partição entre quarto e banheiro, com passagem junto ao vidro
  const partition = box(0.18, 3.0, 8.0, M.estuque);
  partition.position.set(9.3, 1.5, -1);
  g.add(partition);

  const rug = createRug(3.4, 3.6);
  rug.position.set(6.6, 0.125, -0.4);
  g.add(rug);

  const bed = createBed(2.0);
  bed.position.set(6.5, 0.12, -0.6);
  g.add(bed);

  const ns1 = createNightstand(); ns1.position.set(5.2, 0.12, -1.1); g.add(ns1); collectLamps(ns1);
  const ns2 = createNightstand(); ns2.position.set(7.8, 0.12, -1.1); g.add(ns2); collectLamps(ns2);

  const bench = createBench(1.3);
  bench.position.set(6.5, 0.12, 1.35);
  g.add(bench);

  // Armário planejado na parede oeste da suíte (antes: parede vazia)
  const wardrobe = createWardrobe(2.4, 2.4);
  wardrobe.position.set(6.5, 0.12, -5.75);
  g.add(wardrobe);

  // Poltrona de leitura junto ao vidro
  const readChair = createArmchair();
  readChair.position.set(8.4, 0.12, 3.4);
  readChair.rotation.y = -2.5;
  g.add(readChair);

  // Cortinas na fachada de vidro da suíte
  const suiteCurtains = createCurtainRun(3.4, 2.9, 5);
  suiteCurtains.position.set(6.2, 0.12, 5.78);
  g.add(suiteCurtains);

  // Cove no encontro parede/teto, acima do armário.
  //
  // Estava em (6,5 / 1,62 / -1,55), descrito como "cove atrás da
  // cabeceira". Só que a cabeceira NÃO ENCOSTA em parede — a cama fica
  // solta no meio do quarto, com o armário 4,2 m atrás. A fita ficava
  // pendurada no ar lavando o vazio, e de dia aparecia como uma barra
  // clara atravessando o quarto na altura da cabeceira. Sonda: objeto de
  // 2,6 x 0,12 x 0,11 m em z = -1,51, com a parede em z = -5,99.
  //
  // Cove de verdade precisa de superfície para lavar. Vai para a mesma
  // junção parede/teto usada na sala e no nível superior — a casa passa a
  // ter uma linguagem só de luz indireta em vez de três soluções.
  const headCove = createCoveLight(2.6, 0xffd2a0);
  headCove.position.set(6.5, 3.02, -5.86);
  g.add(headCove);
  collectLamps(headCove);

  const art = createWallArt(1.2, 0.8, '#b8ac93');
  art.position.set(4.65, 1.75, -1.0);
  art.rotation.y = Math.PI / 2;
  g.add(art);

  const suiteBaseboard = createBaseboardRun([[4.4, -6.0], [9.2, -6.0]], 0.09, M.portaEscura);
  g.add(suiteBaseboard);

  // ===== BANHEIRO DA SUÍTE =====
  const vanity = createVanity(1.3);
  vanity.position.set(11.75, 0.12, -3.4);
  vanity.rotation.y = -Math.PI / 2;
  g.add(vanity);

  const tub = createBathtub();
  tub.position.set(10.6, 0.12, -5.0);
  g.add(tub);

  // Box de vidro com chuveiro de teto e ralo linear
  const shower = createShowerEnclosure(1.5, 1.3, 2.15);
  shower.position.set(10.4, 0.12, -1.1);
  g.add(shower);

  // Nicho iluminado sobre a banheira — profundidade na parede
  const niche = createNiche(0.9, 0.4, 0.14);
  niche.position.set(10.6, 1.35, -5.68);
  g.add(niche);
  collectLamps(niche);

  const towels = createTowelStack();
  towels.position.set(11.62, 0.85, -4.4);
  g.add(towels);

  const bathPlant = createPottedPlant(0.75);
  bathPlant.position.set(11.7, 0.12, -5.9);
  g.add(bathPlant);

  const bathRug = createRug(1.1, 0.8);
  bathRug.position.set(11.2, 0.125, -2.3);
  g.add(bathRug);

  houseGroup.add(g);
  return g;
}

function buildUpperLevel() {
  const g = new THREE.Group();
  const floorY = 3.63;

  const rug = createRug(2.6, 2.2);
  rug.position.set(-10.6, floorY + 0.005, -2.2);
  g.add(rug);

  const bed = createBed(1.5);
  bed.position.set(-10.6, floorY, -2.6);
  bed.rotation.y = Math.PI / 2;
  g.add(bed);

  const ns = createNightstand();
  ns.position.set(-10.6, floorY, -0.9);
  g.add(ns);
  collectLamps(ns);

  // Escritório definido: mesa + monitor + prateleira. O ambiente tinha
  // uma mesa solta sem identidade — agora é claramente um home office.
  const desk = createDesk();
  desk.position.set(-12.4, floorY, 1.6);
  desk.rotation.y = Math.PI / 2;
  g.add(desk);
  const monitor = createMonitor();
  monitor.position.set(-12.4, floorY + 0.79, 1.6);
  monitor.rotation.y = Math.PI / 2;
  g.add(monitor);

  const shelf = createShelfUnit(1.6, 3);
  shelf.position.set(-12.9, floorY + 0.5, -0.6);
  shelf.rotation.y = Math.PI / 2;
  g.add(shelf);

  const wardrobe = createWardrobe(1.8, 2.2);
  wardrobe.position.set(-8.4, floorY, -4.65);
  g.add(wardrobe);

  const upperCove = createCoveLight(4.4, 0xffd9a8);
  upperCove.position.set(-9.5, floorY + 2.75, -4.6);
  g.add(upperCove);
  collectLamps(upperCove);

  const plant = createPottedPlant(1.0);
  plant.position.set(-4.6, floorY, -4.3);
  g.add(plant);

  // ===== TERRAÇO =====
  for (const [lx, lz, rot] of [[-1.9, -1.6, 0.28], [-1.9, 1.0, -0.28]]) {
    const lounger = createOutdoorLounger();
    lounger.position.set(lx, floorY, lz);
    lounger.rotation.y = rot;
    g.add(lounger);
  }
  const sideTable = createCoffeeTable(0.55, 0.55);
  sideTable.position.set(-1.9, floorY, -0.3);
  g.add(sideTable);

  const terracePlant = createPottedPlant(1.25);
  terracePlant.position.set(-3.9, floorY, 3.5);
  g.add(terracePlant);
  const terracePlant2 = createPottedPlant(0.95);
  terracePlant2.position.set(0.2, floorY, 3.4);
  g.add(terracePlant2);

  // Balizadores rasantes no piso do terraço
  const terraceMat = new THREE.MeshStandardMaterial({ color: 0x8a8479, roughness: 0.4, metalness: 0.6, emissive: 0xffd9a8, emissiveIntensity: 0 });
  emissiveFixtures.push(terraceMat);
  for (const tz of [-2.6, 0.4, 3.2]) {
    const bl = new THREE.Mesh(sharedCyl(0.035, 0.045, 0.34, 6), terraceMat);
    bl.position.set(-0.4, floorY + 0.17, tz);
    bl.castShadow = false;
    g.add(bl);
  }

  houseGroup.add(g);
  return g;
}

// ============================================================
// PAISAGISMO — árvores com base real no chão (corrige o bug de árvores
// "flutuando": tronco nasce em y=0 local e a copa é composta por 2-3
// lobos orgânicos que sobrepõem o topo do tronco, sem gap).
// ============================================================
// ------------------------------------------------------------
// EMISSORES DE VEGETAÇÃO
// Nada aqui cria Mesh: cada função só empilha TRANSFORMAÇÕES nas listas
// que buildLandscaping() converte em InstancedMesh no final. Uma árvore
// com 22 cartões de folha continua custando zero draw call próprio.
// ------------------------------------------------------------
const _cardQ = new THREE.Quaternion();
const _cardSpin = new THREE.Quaternion();
const _cardEu = new THREE.Euler();
const _cardUp = new THREE.Vector3(0, 0, 1);
const _cardDir = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);

// Empilha um cartão cuja normal aponta para `dir`, com giro aleatório no
// próprio plano (senão todos os cartões repetem o mesmo recorte).
function pushCard(out, x, y, z, dir, size, sizeY) {
  _cardDir.copy(dir).normalize();
  _cardQ.setFromUnitVectors(_cardUp, _cardDir);
  _cardSpin.setFromAxisAngle(_zAxis, Math.random() * Math.PI * 2);
  _cardQ.multiply(_cardSpin);
  _cardEu.setFromQuaternion(_cardQ);
  out.push({
    x, y, z,
    rx: _cardEu.x, ry: _cardEu.y, rz: _cardEu.z,
    sx: size, sy: sizeY === undefined ? size : sizeY, sz: 1,
  });
}

// Uma árvore: tronco cônico, 2-4 galhos e uma casca de cartões de folha
// distribuída num elipsoide. Os cartões da casca têm normal apontando
// para fora, então recebem a luz do sol como uma superfície de copa —
// e alguns cartões internos preenchem para a copa não ficar oca.
const _tDir = new THREE.Vector3();
function emitTree(cardOut, trunkOut, x, z, opts) {
  const o = opts || {};
  const trunkH = o.trunkH || (2.6 + Math.random() * 2.2);
  const canopyR = o.canopyR || (1.15 + Math.random() * 0.7);
  const cards = o.cards === undefined ? 20 : o.cards;
  const lean = o.lean === undefined ? 0.05 : o.lean;
  const trunkR = canopyR * (o.trunkR || 0.12);

  // tronco (levemente inclinado — nenhuma árvore cresce no prumo)
  const lx = (Math.random() - 0.5) * lean, lz = (Math.random() - 0.5) * lean;
  trunkOut.push({
    x: x + lx * trunkH * 0.5, y: trunkH / 2, z: z + lz * trunkH * 0.5,
    rx: lz * 2, rz: -lx * 2,
    sx: trunkR, sy: trunkH, sz: trunkR,
  });

  // ------------------------------------------------------------
  // ACHADO NA CAPTURA `qa-exterior-dia`, ampliando o canto inferior
  // direito: os galhos da árvore de primeiro plano apareciam como VARAS
  // DE MADEIRA soltas, atravessando a fachada, com a ponta cortada em
  // disco e sem uma folha em volta.
  //
  // Não era o material nem a geometria do galho (o tronco já é cônico,
  // sharedCyl(0.55, 1, ...)). Era o ENVELOPE. Fazendo a conta:
  //
  //   copa: casca dos cartões entre 0,78 e 1,00 de canopyR
  //   galho: alcance horizontal = sin(tilt) * len
  //          com len até 1,45*canopyR e sin(tilt) até 0,84
  //          -> até 1,22*canopyR   (FORA da copa)
  //   galho: base em 0,62*trunkH, e a copa começa em trunkH - 0,26*canopyR
  //          -> começa bem ABAIXO da folhagem
  //
  // Ou seja: o galho nascia abaixo da copa e terminava fora dela. A ponta
  // ficava contra o céu, e ponta de cone truncado contra o céu lê como
  // cano serrado. Encurtando e subindo a origem, a ponta termina DENTRO
  // da casca de folhas — que é onde galho de árvore de verdade termina.
  const nBranch = o.branches === undefined ? (2 + Math.floor(Math.random() * 3)) : o.branches;
  for (let b = 0; b < nBranch; b++) {
    const az = (b / nBranch) * Math.PI * 2 + Math.random() * 0.9;
    const tilt = 0.55 + Math.random() * 0.45;             // do vertical
    // alcance horizontal máximo: 0,84 * 0,90 = 0,76 de canopyR — dentro
    // da casca, que começa em 0,78
    const len = canopyR * (0.55 + Math.random() * 0.35);
    const baseY = trunkH * (0.84 + Math.random() * 0.10);
    const hx = Math.sin(tilt) * Math.cos(az) * len * 0.5;
    const hz = Math.sin(tilt) * Math.sin(az) * len * 0.5;
    const hy = Math.cos(tilt) * len * 0.5;
    trunkOut.push({
      x: x + hx, y: baseY + hy, z: z + hz,
      rx: Math.cos(az) * tilt, ry: 0, rz: -Math.sin(az) * tilt,
      sx: trunkR * 0.5, sy: len, sz: trunkR * 0.5,
    });
  }

  // copa
  const cy = trunkH + canopyR * (o.canopyLift || 0.52);
  const ry = canopyR * (o.canopyFlat || 0.78);   // elipsoide achatado
  for (let i = 0; i < cards; i++) {
    // 70% na casca externa, 30% no miolo — copa cheia sem ficar sólida
    const shell = i < cards * 0.7;
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const rr = shell ? (0.78 + Math.random() * 0.22) : Math.random() * 0.7;
    _tDir.set(s * Math.cos(phi), u * 0.85, s * Math.sin(phi));
    const px = x + _tDir.x * canopyR * rr;
    const py = cy + _tDir.y * ry * rr;
    const pz = z + _tDir.z * canopyR * rr;
    const cs = canopyR * (o.cardScale || 1.05) * (0.72 + Math.random() * 0.5);
    pushCard(cardOut, px, py, pz, _tDir, cs);
  }
}

// Arbusto: mesma ideia sem tronco, mais achatado e mais denso embaixo.
function emitShrub(cardOut, x, z, scale) {
  const s = scale || 1;
  const n = 9 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 0.9;
    const phi = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    _tDir.set(rr * Math.cos(phi), u * 0.8 + 0.15, rr * Math.sin(phi));
    pushCard(cardOut,
      x + _tDir.x * 0.3 * s, 0.2 * s + _tDir.y * 0.24 * s, z + _tDir.z * 0.3 * s,
      _tDir, (0.46 + Math.random() * 0.24) * s);
  }
}

// Gramínea de primeiro plano: pares de cartões cruzados, verticais.
// Cruzado (e não um cartão só) porque um quad isolado desaparece quando
// visto de canto — o defeito clássico de billboard estático.
function emitGrassTuft(cardOut, x, z, scale) {
  const s = scale || 1;
  const h = (0.42 + Math.random() * 0.34) * s;
  const w = h * (0.8 + Math.random() * 0.5);
  const base = Math.random() * Math.PI;
  for (let k = 0; k < 2; k++) {
    const a = base + k * Math.PI / 2;
    cardOut.push({
      x, y: h * 0.5, z,
      rx: 0, ry: a, rz: 0,
      sx: w, sy: h, sz: 1,
    });
  }
}

// Distância de um ponto ao segmento câmera->alvo, no plano XZ.
function distToSightLine(px, pz, a, b) {
  const vx = b[0] - a[0], vz = b[2] - a[2];
  const wx = px - a[0], wz = pz - a[2];
  const L2 = vx * vx + vz * vz;
  let t = L2 ? (wx * vx + wz * vz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + vx * t, cz = a[2] + vz * t;
  return Math.hypot(px - cx, pz - cz);
}
// Encontrado renderizando: árvores plantadas em cima do corredor de visão
// de vários capítulos, entrando na frente da arquitetura. Em vez de mover
// uma a uma, qualquer planta dentro do corredor é simplesmente rejeitada.
function blocksAnyCamera(px, pz, margin) {
  const chs = CONFIG.chapters || [];
  for (let i = 0; i < chs.length; i++) {
    const c = chs[i].cam;
    // ignora o trecho final: planta perto do ALVO compõe, não atrapalha
    if (distToSightLine(px, pz, c.pos, c.look) < margin) {
      const dToCam = Math.hypot(px - c.pos[0], pz - c.pos[2]);
      const dToTarget = Math.hypot(px - c.look[0], pz - c.look[2]);
      // só rejeita o que está entre a câmera e o alvo, perto da câmera —
      // é aí que a planta tapa a arquitetura. Longe, ela compõe.
      if (dToCam < 9 && dToTarget > 3.0) return true;
    }
  }
  return false;
}

function buildLandscaping() {
  const g = new THREE.Group();

  // Tudo aqui é coletado como TRANSFORMAÇÕES e emitido como
  // InstancedMesh no final: uma árvore de 20 cartões de folha não custa
  // draw call próprio, custa 20 matrizes num buffer.
  const canopyA = [], canopyB = [], canopyC = [], trunkT = [], shrubT = [], grassT = [];

  // Cartões por copa conforme o tier — silhueta é o que mais importa em
  // aparelho fraco, então mesmo em 'low' a árvore continua sendo cartões
  // (só que menos), nunca volta a ser um cone.
  const CARDS = Quality.level === 'low' ? 11 : Quality.level === 'medium' ? 15 : 22;

  const areasProibidas = [
    [-12.1, 5.95, 2.9, 14.45],    // deck da piscina (inclui a lâmina)
    [-13.4, -6.4, 12.4, 6.3],     // pegada da casa
    [-11.9, 6.0, 12.5, 8.0],      // terraço sul em travertino
    [5.75, -9.7, 13.25, -6.5],    // entrada e faixa de cascalho
    [7.3, -16.0, 11.7, -7.0],     // garagem e acesso
    [-11.7, -10.05, 12.3, -8.75], // canteiro do muro frontal
  ];
  // A margem existe por causa da COPA. O teste sem margem só rejeita o
  // tronco; uma árvore plantada rente à parede, com copa de 1,85 m de
  // raio, joga folha para dentro do ambiente do mesmo jeito.
  const emAreaProibida = (px, pz, margem) => {
    const m = margem || 0;
    return areasProibidas.some(
      ([x0, z0, x1, z1]) => px > x0 - m && px < x1 + m && pz > z0 - m && pz < z1 + m);
  };

  // ---- MACIÇOS ARBÓREOS ----
  // Mais maciços e mais fundos que antes: o lote precisa ter vizinhança
  // arborizada, senão a casa fica num campo aberto e some a privacidade,
  // que é justamente um argumento de venda deste terreno.
  const groves = [
    { cx: -11.5, cz: -9.0,  n: 5, spread: 3.4, sp: 0 },
    { cx: -2.5,  cz: -11.5, n: 4, spread: 3.2, sp: 2 },
    { cx: 16.5,  cz: -12.5, n: 4, spread: 3.0, sp: 0 },
    { cx: 16.0,  cz: 3.0,   n: 4, spread: 3.4, sp: 1 },
    { cx: -17.5, cz: 8.0,   n: 5, spread: 3.6, sp: 1 },
    { cx: -9.5,  cz: 16.0,  n: 4, spread: 3.0, sp: 2 },
    { cx: 4.5,   cz: 16.5,  n: 4, spread: 2.8, sp: 0 },
    { cx: -20.0, cz: -4.0,  n: 5, spread: 4.0, sp: 2 },
    { cx: 21.0,  cz: -3.0,  n: 5, spread: 4.0, sp: 1 },
    { cx: 12.0,  cz: 18.0,  n: 4, spread: 3.4, sp: 0 },
    { cx: -16.0, cz: -14.0, n: 4, spread: 3.4, sp: 1 },
    { cx: 0.0,   cz: 22.0,  n: 5, spread: 4.4, sp: 2 },
  ];
  const canopyLists = [canopyA, canopyB, canopyC];
  groves.forEach((gr, gi) => {
    for (let i = 0; i < gr.n; i++) {
      const a = (i / gr.n) * Math.PI * 2 + gi;
      const r = gr.spread * (0.35 + Math.random() * 0.65);
      const x = gr.cx + Math.cos(a) * r, z = gr.cz + Math.sin(a) * r;
      if (blocksAnyCamera(x, z, 1.5)) continue;   // não planta na frente da câmera
      // ACHADO RENDERIZANDO a sala: uma árvore inteira — tronco, galhos e
      // copa — crescendo dentro do ambiente e atravessando o forro. O
      // teste de área proibida já existia e já incluía a pegada da casa;
      // os laços de ARBUSTO e de GRAMÍNEA o chamavam, e o de ÁRVORE não.
      // O objeto maior era o único sem verificação.
      if (emAreaProibida(x, z, 2.0)) continue;
      // Espécie majoritária por maciço, com exemplares de outra espécie
      // misturados: maciço 100% homogêneo lê como carimbo repetido.
      const sp = Math.random() < 0.72 ? gr.sp : Math.floor(Math.random() * 3);
      const tall = sp === 2;                       // a "espécie 3" é esguia
      emitTree(canopyLists[sp], trunkT, x, z, {
        trunkH: tall ? 3.8 + Math.random() * 2.6 : 2.4 + Math.random() * 2.2,
        canopyR: tall ? 1.0 + Math.random() * 0.5 : 1.2 + Math.random() * 0.85,
        canopyFlat: tall ? 1.25 : 0.72 + Math.random() * 0.25,
        cards: CARDS,
      });
    }
  });

  // ---- ÁRVORES SOLITÁRIAS DE COMPOSIÇÃO ----
  // Exemplares isolados perto da casa: é o que dá escala à fachada e
  // sombra no deck. Colocadas à mão, não sorteadas.
  [
    [-15.2, 2.0, 0], [14.8, 9.5, 1], [-6.0, 19.0, 2], [19.5, 12.0, 0],
  ].forEach(([x, z, sp]) => {
    if (blocksAnyCamera(x, z, 1.2)) return;
    if (emAreaProibida(x, z, 2.2)) return;
    emitTree(canopyLists[sp], trunkT, x, z, {
      trunkH: 3.4 + Math.random() * 1.4, canopyR: 1.6 + Math.random() * 0.6,
      cards: CARDS + 4, branches: 4,
    });
  });

  // ---- ARBUSTOS ----
  const shrubSpots = [];
  for (let x = -14.5; x <= 15.5; x += 1.5) shrubSpots.push([x + (Math.random() - 0.5) * 0.4, -9.4 + (Math.random() - 0.5) * 0.5]);
  [[-13.6, -3], [-13.6, 0.5], [-13.4, 4], [14.2, -3], [14.4, 1], [14.2, 5]].forEach(p => shrubSpots.push(p));
  // massa arbustiva sob os maciços — transição do gramado para a mata
  groves.forEach(gr => {
    for (let i = 0; i < 4; i++) {
      shrubSpots.push([
        gr.cx + (Math.random() - 0.5) * gr.spread * 2.4,
        gr.cz + (Math.random() - 0.5) * gr.spread * 2.4,
      ]);
    }
  });
  shrubSpots.forEach(([sx, sz]) => {
    if (emAreaProibida(sx, sz)) return;
    if (blocksAnyCamera(sx, sz, 0.7)) return;
    emitShrub(shrubT, sx, sz, 0.85 + Math.random() * 0.6);
  });

  // ---- GRAMÍNEAS DE PRIMEIRO PLANO ----
  const tuftLines = [
    { x0: -12.4, z0: 8.2, x1: -12.4, z1: 15.4, n: 14 },
    { x0: 3.0,  z0: 7.6, x1: 3.0,  z1: 15.0, n: 12 },
    { x0: -12.0, z0: 16.4, x1: 3.0, z1: 16.4, n: 18 },
    { x0: 13.0, z0: -6.5, x1: 13.0, z1: 2.0, n: 12 },
  ];
  tuftLines.forEach(l => {
    for (let i = 0; i < l.n; i++) {
      const f = i / (l.n - 1 || 1);
      const cx = l.x0 + (l.x1 - l.x0) * f + (Math.random() - 0.5) * 0.6;
      const cz = l.z0 + (l.z1 - l.z0) * f + (Math.random() - 0.5) * 0.6;
      // touceira = alguns tufos próximos, não uma moita única
      for (let b = 0; b < 3; b++) {
        const bx = cx + (Math.random() - 0.5) * 0.55;
        const bz = cz + (Math.random() - 0.5) * 0.55;
        if (emAreaProibida(bx, bz)) continue;
        emitGrassTuft(grassT, bx, bz, 0.9 + Math.random() * 0.5);
      }
    }
  });

  // Tufos esparsos quebrando a borda entre gramado e pavimentação —
  // grama que encosta no piso em linha reta perfeita denuncia CGI.
  //
  for (let i = 0; i < 130; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = 9 + Math.random() * 18;
    const tx = Math.cos(a) * rr, tz = 4 + Math.sin(a) * rr;
    if (emAreaProibida(tx, tz)) continue;
    if (blocksAnyCamera(tx, tz, 0.6)) continue;
    emitGrassTuft(grassT, tx, tz, 0.55 + Math.random() * 0.45);
  }

  // ---- EMISSÃO ----
  // Cartão de folha = 1 quad. Um PlaneGeometry unitário compartilhado
  // por todos: copas, arbustos e gramíneas usam a mesma geometria.
  const unitCard = new THREE.PlaneGeometry(1, 1);

  // vento: gramínea balança mais que arbusto, que balança mais que copa
  applyWind(M.copaArvore, 0.05);
  applyWind(M.copaArvore2, 0.045);
  applyWind(M.copaArvore3, 0.055);
  applyWind(M.arbusto, 0.035);
  applyWind(M.graminea, 0.09);

  // Tronco cônico de verdade (topo 55% da base), não cilindro reto.
  const trunkGeo = sharedCyl(0.55, 1, 1, 8);

  [[canopyA, M.copaArvore], [canopyB, M.copaArvore2], [canopyC, M.copaArvore3]]
    .forEach(([list, mat]) => {
      const im = buildInstanced(unitCard, mat, list, true);
      if (im) g.add(im);
    });
  const imTrunk = buildInstanced(trunkGeo, M.troncoArvore, trunkT, true);
  if (imTrunk) g.add(imTrunk);
  // Arbusto e gramínea não projetam sombra: são centenas de quads no
  // shadow map por um ganho que a sombra de contato do gramado já dá.
  const imShrub = buildInstanced(unitCard, M.arbusto, shrubT, false);
  if (imShrub) g.add(imShrub);
  const imGrass = buildInstanced(unitCard, M.graminea, grassT, false);
  if (imGrass) g.add(imGrass);

  // Pedras decorativas (poucas, mantidas como meshes normais).
  // Cada uma com semente propria: quatro copias identicas do mesmo matacao
  // denunciariam a repeticao tanto quanto o icosaedro denunciava a origem.
  for (const [rx, rz, rs, seed] of [[-13.0, 6.4, 0.5, 1.7], [-11.6, 7.0, 0.32, 4.2],
                                    [13.6, -1.5, 0.45, 8.9], [12.4, 6.2, 0.38, 12.4]]) {
    const rock = new THREE.Mesh(boulderGeometry(seed), M.pedraJardim);
    rock.position.set(rx, rs * 0.45, rz);
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    rock.scale.set(rs, rs * 0.65, rs);
    rock.castShadow = true; rock.receiveShadow = true;
    g.add(rock);
  }

  houseGroup.add(g);
  return g;
}

// ============================================================
// PISCINA + DECK
// ============================================================
function buildPoolAndDeck() {
  const g = new THREE.Group();

  const poolW = 10.2, poolD = 5.0;
  const poolCx = -5.6, poolCz = 10.4;
  const waterY = 0.02;
  const copingW = 0.34;

  // ------------------------------------------------------------
  // BUG CORRIGIDO — o deck passava POR BAIXO da piscina
  // Só apareceu depois de abrir a bacia: o deck era uma laje inteiriça
  // de 15 x 8,5 m, e a piscina fica DENTRO dessa pegada. Enquanto o
  // casco era um bloco maciço até y=0,02, a laje ficava escondida. Com
  // a bacia aberta, o que se via dentro da piscina era a madeira do
  // deck atravessando na altura da água.
  //
  // O deck agora é recortado em quatro faixas em volta do conjunto
  // piscina + borda, mantendo exatamente a mesma pegada externa.
  // ------------------------------------------------------------
  const deckX0 = -12.1, deckX1 = 2.9, deckZ0 = 5.95, deckZ1 = 14.45;
  const vaoX0 = poolCx - poolW / 2 - copingW, vaoX1 = poolCx + poolW / 2 + copingW;
  const vaoZ0 = poolCz - poolD / 2 - copingW, vaoZ1 = poolCz + poolD / 2 + copingW;
  [
    [deckX0, deckZ0, deckX1, vaoZ0],   // faixa norte
    [deckX0, vaoZ1, deckX1, deckZ1],   // faixa sul
    [deckX0, vaoZ0, vaoX0, vaoZ1],     // faixa oeste
    [vaoX1, vaoZ0, deckX1, vaoZ1],     // faixa leste
  ].forEach(([x0, z0, x1, z1]) => {
    const w = x1 - x0, d = z1 - z0;
    if (w <= 0.01 || d <= 0.01) return;
    const faixa = box(w, 0.1, d, M.ipe, false);
    faixa.position.set((x0 + x1) / 2, 0.05, (z0 + z1) / 2);
    g.add(faixa);
  });

  // ------------------------------------------------------------
  // BUG CORRIGIDO — a piscina não tinha água visível
  // Localizado por raycast (matAt) na câmera do capítulo "Piscina": o
  // que aparecia onde deveria estar a lâmina d'água era o material
  // `bordaPiscina`. A borda era UMA LAJE MACIÇA de 10,64 x 5,44 m
  // cobrindo a piscina inteira (box(poolW+0.44, 0.12, poolD+0.44)
  // centrado em poolCx/poolCz), com o topo em y=0,12 — e a água em
  // y=0,03, ou seja, 9 cm ABAIXO dela. A piscina inteira, o Water.js
  // com reflexão planar, os degraus submersos e o desnível do fundo
  // estavam escondidos embaixo de uma tampa de pedra.
  //
  // Agora a borda é o que o comentário original já dizia que era: uma
  // moldura de quatro faixas estreitas em volta do espelho d'água.
  // ------------------------------------------------------------
  [
    [poolW + copingW * 2, copingW, poolCx, poolCz - poolD / 2 - copingW / 2],   // norte
    [poolW + copingW * 2, copingW, poolCx, poolCz + poolD / 2 + copingW / 2],   // sul
    [copingW, poolD, poolCx - poolW / 2 - copingW / 2, poolCz],                 // oeste
    [copingW, poolD, poolCx + poolW / 2 + copingW / 2, poolCz],                 // leste
  ].forEach(([cw, cd, ccx, ccz]) => {
    const faixa = box(cw, 0.12, cd, M.bordaPiscina);
    faixa.position.set(ccx, 0.06, ccz);
    g.add(faixa);
  });

  // ------------------------------------------------------------
  // BUG CORRIGIDO — o casco era um BLOCO MACIÇO
  // O comentário anterior dizia "profundidade real", mas o que o código
  // fazia era empilhar 6 caixas cujo TOPO ficava sempre em waterY (0,02),
  // variando só quanto elas desciam. Como o que se vê é o topo, o fundo
  // da piscina era perfeitamente plano e o desnível não aparecia em
  // lugar nenhum. Os degraus submersos, posicionados entre -0,11 e
  // -0,55, ficavam DENTRO do bloco — geometria morta.
  //
  // Agora é uma bacia de verdade: laje de fundo em degraus descendo do
  // raso para o fundo, e quatro paredes de casco. O desnível fica
  // visível através da lâmina, os degraus de entrada aparecem, e a água
  // ganha o que faz água parecer água — profundidade legível.
  // ------------------------------------------------------------
  const shallowD = 0.85, deepD = 1.7;
  const segs = 6;
  const wallT = 0.12;

  // laje de fundo: cada trecho tem o topo na cota daquele ponto
  for (let i = 0; i < segs; i++) {
    const f = i / (segs - 1);
    const d = shallowD + (deepD - shallowD) * f;
    const segW = poolW / segs;
    const laje = box(segW + 0.02, 0.12, poolD, M.revestPiscina, false);
    laje.position.set(poolCx - poolW / 2 + segW * (i + 0.5), waterY - d - 0.06, poolCz);
    g.add(laje);
  }

  // paredes do casco, do fundo até logo abaixo da borda
  const wallH = deepD + 0.12;
  const wallY = waterY - wallH / 2 + 0.04;
  [
    [poolW + wallT * 2, wallT, poolCx, poolCz - poolD / 2 - wallT / 2],
    [poolW + wallT * 2, wallT, poolCx, poolCz + poolD / 2 + wallT / 2],
    [wallT, poolD, poolCx - poolW / 2 - wallT / 2, poolCz],
    [wallT, poolD, poolCx + poolW / 2 + wallT / 2, poolCz],
  ].forEach(([ww, wd, wx, wz]) => {
    const parede = box(ww, wallH, wd, M.revestPiscina, false);
    parede.position.set(wx, wallY, wz);
    g.add(parede);
  });

  // Degraus de entrada na ponta rasa. Agora ficam DENTRO da bacia e
  // aparecem através da lâmina — antes estavam enterrados no bloco.
  for (let i = 0; i < 3; i++) {
    const st = box(2.0, 0.20, 0.44, M.bordaPiscina, false);
    st.position.set(poolCx - poolW / 2 + 1.15,
                    waterY - 0.12 - i * 0.20,
                    poolCz - poolD / 2 + 0.36 + i * 0.44);
    g.add(st);
  }

  // Lâmina d'água: muro elevado em pedra na face norte, com rasgo de
  // saída. É o elemento que ancora a piscina na arquitetura em vez de
  // deixá-la solta no deck.
  const spillWall = box(poolW * 0.5, 1.15, 0.34, M.stoneCore);
  spillWall.position.set(poolCx + 1.4, 0.58, poolCz - poolD / 2 - 0.5);
  g.add(spillWall);
  const scupper = box(poolW * 0.42, 0.05, 0.4, M.metal, false);
  scupper.position.set(poolCx + 1.4, 1.0, poolCz - poolD / 2 - 0.5);
  g.add(scupper);

  // ============================================================
  // ÁGUA DA PISCINA — transparente, não espelhada
  // ------------------------------------------------------------
  // DECISÃO REVISTA depois de renderizar duas vezes a câmera do
  // capítulo "Piscina". O Water.js entrega reflexão planar de verdade e
  // é a escolha certa para lago, mar, espelho d'água — corpo de água
  // grande, visto de longe, onde o que importa é o que ele reflete.
  //
  // Piscina é o caso oposto. Ela é vista de perto e quase sempre em
  // ângulo rasante, e nesse ângulo a reflexão domina por Fresnel: o que
  // aparecia era uma chapa branca refletindo o céu claro. Pior, o
  // Water.js não refrata o fundo — então o revestimento, o desnível do
  // raso para o fundo e os degraus de entrada ficavam invisíveis.
  //
  // O que faz uma piscina parecer piscina, e o que a vende, é VER O
  // FUNDO através da água. Por isso aqui a lâmina é transparente, com
  // reflexo de ambiente contido e ondulação por normal map animado. É a
  // solução tecnicamente correta PARA ESTE CASO, e ainda custa um passe
  // de render a menos que a reflexão planar.
  // ============================================================
  const water = new THREE.Mesh(new THREE.PlaneGeometry(poolW, poolD), M.agua);
  water.rotation.x = -Math.PI / 2;
  water.position.set(poolCx, waterY, poolCz);
  water.receiveShadow = false;
  water.renderOrder = 2;          // depois do casco, para compor por cima
  water.userData.noMerge = true;
  g.add(water);
  waterObj = water;

  // Borda infinita na face sul
  const infinityEdge = box(poolW, 0.1, 0.26, M.bordaPiscina);
  infinityEdge.position.set(poolCx, -0.04, poolCz + poolD / 2 + 0.08);
  g.add(infinityEdge);

  // ILUMINAÇÃO SUBAQUÁTICA — 4 pontos dentro do casco. À noite é isso
  // que transforma a piscina no elemento mais forte da cena.
  // 2 luzes reais (a piscina é elemento herói, merece luz de verdade)
  // 1 luz real submersa, ampla o bastante para cobrir o espelho d'água.
  // A piscina é elemento herói, então ela fica fora do corte de orçamento.
  const uw = new THREE.PointLight(0x6fd4e8, 0, 13, 2);
  uw.position.set(poolCx, -0.5, poolCz);
  g.add(uw);
  lampLights.push(uw);

  // Espreguiçadeiras alinhadas na face sul, voltadas para a água
  for (const lx of [-9.4, -8.4, -2.6, -1.6]) {
    const lounger = createOutdoorLounger();
    lounger.position.set(lx, 0.1, 14.0);
    lounger.rotation.y = Math.PI;
    g.add(lounger);
  }
  // z=13,75 e não 12,9: com o vão da piscina recortado no deck, 12,9
  // caía DENTRO da lâmina d'água — as mesinhas ficariam boiando.
  for (const tx of [-8.9, -2.1]) {
    const t = createCoffeeTable(0.5, 0.5);
    t.position.set(tx, 0.1, 13.75);
    g.add(t);
  }

  const firepit = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.35, 16), M.concreto);
  firepit.position.set(-5.6, 0.28, 15.4);
  firepit.castShadow = true; firepit.receiveShadow = true;
  g.add(firepit);
  const flame = new THREE.PointLight(0xff8a3d, 0, 4.5, 2);
  flame.position.set(-5.6, 0.6, 15.4);
  g.add(flame);
  lampLights.push(flame);

  // área gourmet coberta — pergolado de madeira na extremidade leste do
  // deck, com mesa externa e churrasqueira (Regra 10)
  // Vão do pergolado reduzido de ±1,6 para ±1,3 m: com o deck recortado
  // em volta da piscina, os pilares oeste (x = -0,4) ficavam DENTRO do
  // vão da lâmina d'água — apoiados no nada. Agora caem em x = -0,1,
  // sobre a faixa leste do deck.
  const pergolaX = 1.2, pergolaZ = 10.4, pergolaHalf = 1.3;
  for (const px of [pergolaX - pergolaHalf, pergolaX + pergolaHalf]) {
    for (const pz of [pergolaZ - 1.8, pergolaZ + 1.8]) {
      const post = box(0.12, 2.4, 0.12, M.cumaru);
      post.position.set(px, 1.2, pz);
      g.add(post);
    }
  }
  const beamLen = pergolaHalf * 2 + 0.4;
  const pergolaBeamA = box(beamLen, 0.12, 0.12, M.cumaru);
  pergolaBeamA.position.set(pergolaX, 2.42, pergolaZ - 1.8); g.add(pergolaBeamA);
  const pergolaBeamB = box(beamLen, 0.12, 0.12, M.cumaru);
  pergolaBeamB.position.set(pergolaX, 2.42, pergolaZ + 1.8); g.add(pergolaBeamB);
  for (let i = 0; i <= 6; i++) {
    const slat = box(0.08, 0.06, 3.9, M.cumaru);
    slat.position.set(pergolaX - pergolaHalf + i * (pergolaHalf * 2 / 6), 2.5, pergolaZ);
    g.add(slat);
  }
  const gourmetTable = createDiningSet(4, 1.7);
  gourmetTable.position.set(pergolaX, 0.1, pergolaZ);
  g.add(gourmetTable);
  collectLamps(gourmetTable);

  const grillBody = box(0.9, 0.85, 0.55, M.metal);
  grillBody.position.set(pergolaX + 1.5, 0.42, pergolaZ);
  g.add(grillBody);
  const grillTop = box(0.95, 0.08, 0.6, M.stoneCore);
  grillTop.position.set(pergolaX + 1.5, 0.89, pergolaZ);
  g.add(grillTop);

  // iluminação de percurso ao longo da borda do deck
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0x8a8479, roughness: 0.4, metalness: 0.6, emissive: 0xffd9a0, emissiveIntensity: 0 });
  emissiveFixtures.push(bollardMat);
  const pathLightSpots = [[-11.6, 6.4], [-11.6, 13.6], [-8, 14.4], [-2, 14.4], [2.6, 13.6], [2.6, 7.0]];
  pathLightSpots.forEach(([lx, lz]) => {
    // Balizadores: geometria compartilhada + material emissivo comum.
    // Antes eram 6 PointLights reais por um efeito que a emissiva resolve.
    const bollard = new THREE.Mesh(sharedCyl(0.04, 0.05, 0.5, 6), bollardMat);
    bollard.position.set(lx, 0.25, lz);
    bollard.castShadow = false;
    g.add(bollard);
  });

  for (const [px, pz] of [[-11.4, 7.2], [-11.4, 13.4], [2.4, 12.8]]) {
    const plant = createPottedPlant(1.3);
    plant.position.set(px, 0.1, pz);
    g.add(plant);
  }

  poolLight.position.set(poolCx, 1.3, poolCz);

  houseGroup.add(g);
  materialCentroids['Agua_Piscina'] = new THREE.Vector3(poolCx, 0.1, poolCz);
  materialCentroids['Area_Gourmet'] = new THREE.Vector3(pergolaX, 1.0, pergolaZ);
  return g;
}

// ============================================================
// TERRENO
// Composição em zonas (não é mais um único plano verde): terraço em
// travertino junto às fachadas de vidro, caminho pavimentado da garagem
// até a entrada, canteiros com meio-fio, cascalho como transição, e o
// gramado só nas áreas mais afastadas da casa.
// ============================================================
function groundPlane(w, d, cx, cz, mat, y) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  p.rotation.x = -Math.PI / 2;
  p.position.set(cx, y === undefined ? -0.02 : y, cz);
  p.receiveShadow = true;
  return p;
}

// Altura do terreno de fundo em qualquer ponto. Precisa ser uma função
// pública porque a mata distante e o relevo do horizonte se APOIAM nela
// — sem isso as árvores de fundo flutuariam sobre as ondulações.
// Anulada num raio de 42 m: o lote implantado é plano, como lote real é.
function farGroundHeight(wx, wz) {
  const d = Math.hypot(wx, wz);
  const t = Math.max(0, Math.min(1, (d - 42) / 108));   // rampa suave
  const k = t * t * (3 - 2 * t);
  if (k === 0) return 0;
  return k * (
    Math.sin(wx * 0.0121 + 1.3) * Math.cos(wz * 0.0094 - 0.7) * 3.4 +
    Math.sin(wx * 0.0043 - 2.1) * Math.cos(wz * 0.0051 + 1.9) * 6.8 +
    Math.sin(wx * 0.0305 + 0.4) * Math.cos(wz * 0.0288 + 2.6) * 0.9
  );
}

// Terreno de fundo com relevo suave.
function farGroundMesh(size, segs) {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);   // plano ainda em XY
    pos.setZ(i, farGroundHeight(x, y + 4));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, M.campoDistante);
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, -0.08, 4);
  m.receiveShadow = true;
  m.userData.noMerge = true;   // malha grande, não ganha nada em fundir
  return m;
}

function curb(w, d, cx, cz, h) {
  const c = box(w, h || 0.12, d, M.meioFio, false);
  c.position.set(cx, (h || 0.12) / 2 - 0.02, cz);
  return c;
}

// ============================================================
// PAISAGEM DISTANTE
// Achado renderizando: o terreno terminava em 70x55 m e virava céu. O
// mundo acabava atrás da casa, e sem nada no horizonte não existe
// perspectiva atmosférica — a casa parecia um objeto sobre uma mesa.
// Anéis de vegetação distante + relevo suave criam profundidade real.
// Tudo instanciado e sem sombra: custo próximo de zero.
// ============================================================
function buildDistantLandscape() {
  const g = new THREE.Group();

  // ------------------------------------------------------------
  // BUG ENCONTRADO RENDERIZANDO (o horizonte "cortado" da V9)
  // Os morros eram IcosahedronGeometry posicionados em y = -9 a -13 com
  // escala vertical 5,5 a 10 — ou seja, o TOPO ficava em y ≈ -3, abaixo
  // do nível do terreno. Estavam literalmente enterrados; o horizonte
  // não tinha nada além do gramado terminando no céu.
  //
  // Correção em três partes:
  // 1. relevo com base em y=0 e altura real (14 a 40 m), a 220-430 m;
  // 2. o gramado de fundo passou de 260 m para 900 m (buildGround), para
  //    o terreno alcançar visualmente a base do relevo em vez de acabar;
  // 3. a névoa exponencial já existente faz o resto — o relevo entra
  //    dessaturado e claro, que é perspectiva aérea de verdade.
  // ------------------------------------------------------------
  const hillMat = new THREE.MeshStandardMaterial({
    color: 0x74856a, roughness: 1.0, metalness: 0, envMapIntensity: 0.18,
    flatShading: false, fog: true,
  });
  // Esfera de baixa resolução achatada lê como encosta arredondada; o
  // icosaedro de 20 faces lia como pedra facetada.
  const hillGeo = new THREE.SphereGeometry(1, 12, 8);
  const hills = [];
  for (let ring = 0; ring < 2; ring++) {
    const n = ring === 0 ? 22 : 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.35 + ring * 0.7;
      const r = (ring === 0 ? 225 : 340) + Math.random() * 95;
      const w = (ring === 0 ? 90 : 150) + Math.random() * 110;
      const h = (ring === 0 ? 16 : 26) + Math.random() * (ring === 0 ? 16 : 24);
      hills.push({
        x: Math.cos(a) * r, y: farGroundHeight(Math.cos(a) * r, Math.sin(a) * r) - h * 0.12,
        z: Math.sin(a) * r,   // base enterrada de leve no proprio terreno
        ry: Math.random() * Math.PI,
        sx: w, sy: h, sz: w * (0.6 + Math.random() * 0.3),
      });
    }
  }
  buildInstancedSectors(hillGeo, hillMat, hills, false, 6)
    .forEach(m => { m.receiveShadow = false; g.add(m); });

  // ------------------------------------------------------------
  // MASSA ARBÓREA DISTANTE
  // Cones foram substituídos por cartões cruzados com o mesmo recorte de
  // folha das árvores próximas. À distância o que importa é a silhueta,
  // e silhueta de cone é o que fazia a mata de fundo parecer cenário de
  // jogo. Cada árvore são 2 cartões cruzados — 1 draw call para todas.
  // ------------------------------------------------------------
  const farMat = new THREE.MeshStandardMaterial({
    map: leafCardTexture('#54704a', { count: 200, leafScale: 1.4 }),
    alphaTest: 0.45, side: THREE.DoubleSide,
    roughness: 1.0, metalness: 0, envMapIntensity: 0.15, fog: true,
  });
  const unitCard = new THREE.PlaneGeometry(1, 1);
  const far = [];
  // ------------------------------------------------------------
  // MEDIDO na captura `qa-exterior-dia`, com a sonda de pixels:
  //
  //   colina distante (225-435 m):  desvio de luminância  5,2
  //   faixa de mata   (46-158 m):   desvio de luminância 33,0
  //
  // Seis vezes mais contraste local NA FRENTE de um fundo já quase
  // totalmente apagado. Perspectiva aérea de verdade é monotônica: o
  // contraste cai com a distância e não volta. Aqui ele dava um degrau.
  //
  // A causa não é a névoa — ela está certa. É que a massa arbórea
  // TERMINAVA em 158 m. Com FogExp2(0,0033):
  //
  //   158 m -> 24% de névoa      (última árvore, ainda nítida)
  //   225 m -> 62% de névoa      (primeiro relevo, já fantasma)
  //
  // Entre um e outro há 67 m de nada, e é justamente onde a curva de
  // névoa é mais íngreme. O olho lê isso como um decalque de árvores
  // colado sobre uma pintura de fundo.
  //
  // A correção é preencher a faixa, não mexer na névoa: anéis adicionais
  // até ~270 m, onde a névoa já chega a 63% e encontra o relevo no mesmo
  // valor. Como só as árvores GRANDES ainda se distinguem a essa
  // distância, a escala cresce com o anel — o que também é mais barato,
  // porque entrega a mesma silhueta com menos cartões.
  //
  // CUSTO, antes de aceitar: os dois anéis novos somam ~1.350 cartões
  // contra os ~1.380 que já existiam — quase o dobro de instâncias. Mas
  // custo de preenchimento cai com o quadrado da distância, e a conta
  // fecha assim: uma árvore do anel 4-5 fica a ~190 m com porte 1,8;
  // uma do anel 0 fica a ~60 m com porte 1,0. Tamanho angular
  // (1,8/190) / (1,0/60) = 0,57, logo ÁREA 0,32. O acréscimo real de
  // preenchimento é ~1/3 do que o anel existente já custa, não o dobro.
  // Ainda assim fica fora de `low` e `medium`: lá o anel de mata já é o
  // maior custo de preenchimento da cena, e o ganho é de composição, não
  // de legibilidade.
  const rings = Quality.level === 'low' ? 3
              : (Quality.level === 'ultra' || Quality.level === 'high') ? 6 : 4;
  for (let ring = 0; ring < rings; ring++) {
    const rBase = 46 + ring * 30;
    // Densidade angular constante: a circunferência cresce com o raio,
    // então a contagem precisa crescer junto ou a mata rareia ao longe.
    const count = 90 + ring * 55;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const r = rBase + Math.random() * 22;
      // +18% de porte por anel: a 270 m uma árvore de 6 m ocupa 17 px e
      // vira granulado; uma de 12 m ocupa 34 px e ainda lê como copa.
      const porte = 1 + ring * 0.18;
      const sc = (3.0 + Math.random() * 3.4) * porte;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const gy = farGroundHeight(x, z);   // apoia no relevo, não no plano
      // dois cartões cruzados: a árvore não some quando vista de canto
      const base = Math.random() * Math.PI;
      for (let k = 0; k < 2; k++) {
        far.push({
          x, y: gy + sc * 0.5, z, ry: base + k * Math.PI / 2,
          sx: sc * 0.9, sy: sc, sz: 1,
        });
      }
    }
  }
  // 8 setores: o anel de mata é o maior custo de preenchimento da cena
  buildInstancedSectors(unitCard, farMat, far, false, 8).forEach(m => g.add(m));

  scene.add(g);
  return g;
}
function buildGround() {
  const g = new THREE.Group();

  // base — gramado de fundo, mais discreto do que antes
  // 900 m em vez de 260: o terreno precisa alcançar a base do relevo
  // distante, senão volta o horizonte cortado.
  //
  // E não pode ser um plano liso: com a névoa corrigida, um gramado
  // perfeitamente plano até o horizonte é justamente o que faz a casa
  // parecer objeto sobre uma mesa. A malha é deslocada por ruído, com o
  // deslocamento ANULADO num raio de 42 m em volta da casa — o lote
  // continua plano, como lote implantado realmente é, e o relevo começa
  // além dele. 96x96 segmentos = ~18 mil triângulos num único draw call.
  g.add(farGroundMesh(900, 96));
  // Gramado do lote: disco de 130 m com a textura detalhada, por cima do
  // campo distante. A emenda entre os dois cai onde o relevo ainda é
  // zero, então não há degrau — e a diferença de tom é a mesma variação
  // que o gramado já tem.
  const lote = new THREE.Mesh(new THREE.CircleGeometry(130, 48), M.gramado);
  lote.rotation.x = -Math.PI / 2;
  lote.position.set(0, -0.06, 4);
  lote.receiveShadow = true;
  lote.userData.noMerge = true;
  g.add(lote);

  // terraço sul (fachadas de vidro da ala social e da suíte) — a faixa de
  // transição em travertino que a Regra 8 pediu, entre a casa e o jardim
  g.add(groundPlane(24.4, 2.0, 0.3, 7.0, M.terraco, -0.015));
  g.add(curb(24.6, 0.12, 0.3, 7.95, 0.1));

  // terraço norte / entrada
  g.add(groundPlane(7.5, 3.2, 9.5, -8.1, M.terraco, -0.015));
  const canopy2 = box(0.15, 0.15, 3.2, M.meioFio, false);
  canopy2.position.set(6.0, 0.03, -8.1);
  g.add(canopy2);

  // caminho da garagem até a entrada
  g.add(groundPlane(2.0, 2.6, 9.5, -6.9, M.caminho, -0.012));

  // faixa de cascalho como transição entre o caminho e o canteiro do muro
  g.add(groundPlane(2.6, 8.6, 13.6, -8, M.cascalho, -0.018));

  // canteiros junto ao muro frontal, com meio-fio
  g.add(groundPlane(24, 1.3, 0.3, -9.4, M.canteiro, -0.01));
  g.add(curb(24.2, 0.12, 0.3, -8.75, 0.14));
  g.add(curb(24.2, 0.12, 0.3, -10.05, 0.14));

  houseGroup.add(g);

  const drivewaySlab = box(4.2, 0.03, 9, M.concreto, false);
  drivewaySlab.position.set(9.5, -0.005, -11.5);
  houseGroup.add(drivewaySlab);
  const drivewayCurbL = curb(0.12, 9, 7.3, -11.5, 0.1);
  const drivewayCurbR = curb(0.12, 9, 11.7, -11.5, 0.1);
  houseGroup.add(drivewayCurbL); houseGroup.add(drivewayCurbR);
}

// ============================================================
// ORQUESTRADOR DA CENA
// Etapas reais (não é barra de progresso falsa): cada etapa corresponde a
// um grupo de objetos de verdade sendo criado.
// ============================================================
// ============================================================
// SEMENTE — a cena precisa ser a MESMA em toda visita
// ------------------------------------------------------------
// ACHADO tentando comparar duas capturas: a vegetação sorteia posição,
// porte e inclinação com `Math.random()`, sem semente. São 127 chamadas
// no arquivo. Consequências, em ordem de gravidade:
//
//  1. ESTE É UM MATERIAL DE VENDA. O corretor abre a casa numa reunião,
//     abre de novo na seguinte, e o jardim está diferente. Uma maquete
//     que muda sozinha não é uma maquete do imóvel.
//  2. Nenhum A/B de imagem é confiável perto de vegetação: metade da
//     diferença entre dois quadros é o sorteio, não a mudança. Passei
//     por isso medindo o telhado e tive de escolher métricas imunes ao
//     sorteio (razão de canal na mesma superfície) para contornar.
//
// Trocar as 127 chamadas seria invasivo e fácil de errar. Em vez disso,
// `Math.random` é substituído por um gerador semeado DURANTE cada etapa
// síncrona de construção, e devolvido em seguida.
//
// POR ETAPA, e não uma vez para a cena inteira, por dois motivos:
//  - `buildScene` é async e cede um quadro entre etapas; com o patch
//    instalado atravessando o `await`, qualquer outro código que sorteie
//    nesse intervalo (three, gsap, o laço de render) entraria no mesmo
//    fluxo e o resultado deixaria de ser reproduzível;
//  - cada etapa ganha um fluxo próprio, derivado do NOME dela. Mexer no
//    paisagismo passa a não deslocar o sorteio da arquitetura.
//
// `?semente=N` troca o conjunto inteiro, para quem quiser outra
// implantação de jardim sem mexer em código.
const _SEMENTE_BASE = (() => {
  const p = new URLSearchParams(location.search).get('semente');
  const n = p === null ? NaN : Number(p);
  return Number.isFinite(n) ? (n >>> 0) : 0x9e3779b9;
})();

function comSementeFixa(rotulo, fn) {
  // FNV-1a do rótulo, misturado com a semente base: rótulos diferentes
  // dão fluxos independentes, e nenhum deles é zero (xorshift travaria).
  let s = (2166136261 ^ _SEMENTE_BASE) >>> 0;
  for (let i = 0; i < rotulo.length; i++) {
    s = Math.imul(s ^ rotulo.charCodeAt(i), 16777619) >>> 0;
  }
  if (s === 0) s = 1;
  const original = Math.random;
  Math.random = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
  // `finally`: se uma etapa lançar, o `Math.random` do resto da página
  // não pode ficar sequestrado — inclusive porque o próprio caminho de
  // fallback roda depois.
  try { return fn(); } finally { Math.random = original; }
}

async function buildScene(onProgress) {
  const _tBoot = performance.now();
  const steps = [
    ['Materiais', () => {
      buildMaterials();
      // texturas externas sobrescrevem as procedurais quando existirem
      if (Assets && Assets.available) {
        const n = Assets.applyToMaterials(M);
        if (DEBUG && n) console.info('Texturas PBR externas aplicadas:', n);
      }
      // Adaptação por tier ANTES da fusão: em medium/low o vidro deixa de
      // usar transmission e vira transparente. Se isso acontecesse depois,
      // a fusão já teria tratado o vidro como opaco e juntado todos os
      // panos num mesh só, com a ordenação de transparência errada.
      adaptMaterialsToQuality();
    }],
    ['Arquitetura', buildArchitecture],
    ['Sala de Estar', buildLivingRoom],
    ['Jantar', buildDining],
    ['Cozinha', buildKitchen],
    ['Suíte Master', buildPrimarySuite],
    // Depois dos cômodos: as corridas seguem as paredes de
    // `buildArchitecture`, e o grupo próprio deixa a fusão por material
    // juntar as sete corridas em três malhas.
    ['Acabamento Interno', buildInteriorTrim],
    ['Nível Superior', buildUpperLevel],
    ['Piscina & Deck', buildPoolAndDeck],
    ['Paisagismo', buildLandscaping],
    ['Terreno', buildGround],
    // buildDistantLandscape estava escrita, comentada e completa — e nunca
    // era chamada. Foi encontrada procurando função sem nenhuma referência
    // além da própria definição. Ou seja: o relevo distante e a massa de
    // mata do horizonte, feitos justamente para a casa parar de parecer um
    // objeto sobre uma mesa, nunca chegaram à cena. Nenhum erro no console
    // denuncia isso — só olhar o horizonte, ou contar as referências.
    ['Paisagem Distante', buildDistantLandscape],
  ];

  houseGroup = new THREE.Group();
  scene.add(houseGroup);

  // Capítulos definidos ANTES do paisagismo: a vegetação precisa saber
  // onde as câmeras olham para não ser plantada na frente delas.
  buildChaptersAndHotspots();

  const builtGroups = [];
  // Custo por etapa, em milissegundos. Sem isto, "o boot está lento" não
  // aponta para lugar nenhum: a geração procedural de textura e a
  // construção de geometria são coisas diferentes e se otimizam de jeitos
  // diferentes. Fica sempre ligado (é um número por etapa) e sai no
  // console com ?debug=1.
  Perf.steps = [];
  for (let i = 0; i < steps.length; i++) {
    const [name, fn] = steps[i];
    BuildTrace.start(name);
    const t0 = performance.now();
    try {
      const r = comSementeFixa(name, fn);
      if (r && r.isObject3D) builtGroups.push([name, r]);
    } catch (e) {
      BuildTrace.fail(name, e);
      throw e;
    }
    Perf.steps.push([name, +(performance.now() - t0).toFixed(1)]);
    BuildTrace.complete(name);
    if (onProgress) onProgress((i + 1) / steps.length);
    // cede um frame entre etapas para a barra de progresso pintar de verdade
    await new Promise(r => requestAnimationFrame(r));
  }

  optimizeShadowCasters();

  // Fusão DEPOIS de optimizeShadowCasters: os sinalizadores de sombra já
  // estão resolvidos e entram na chave do agrupamento.
  let mergedSaved = 0;
  builtGroups.forEach(([name, grp]) => { mergedSaved += mergeStaticByMaterial(grp, name); });
  if (upperMass) mergedSaved += mergeStaticByMaterial(upperMass, 'Volume Superior');

  // ------------------------------------------------------------
  // PASSE GLOBAL — a fusão por grupo deixa dinheiro na mesa
  // ------------------------------------------------------------
  // mergeStaticByMaterial roda DENTRO de cada grupo. M.estuque aparece na
  // arquitetura, na cozinha e na suíte: três grupos, três meshes, três
  // draw calls, mesmo material. Contado na cena depois da fusão por
  // grupo: 22 materiais com mais de um mesh e 95 meshes que poderiam
  // desaparecer.
  //
  // Este passe roda sobre houseGroup inteiro. As mesmas exclusões valem —
  // e a parada em userData.mergeRoot continua protegendo o Modo Corte,
  // porque o percurso de mergeStaticByMaterial não entra em upperMass.
  mergedSaved += mergeStaticByMaterial(houseGroup, 'Global entre grupos');
  mergedSaved += mergeContactShadows(houseGroup);
  if (DEBUG) console.info('Fusão estática: -' + mergedSaved + ' draw calls no total');

  // Oclusão de IBL de interior — aplicada percorrendo a CENA, não o
  // registro M. São 134 materiais na cena contra 36 em M; iterar M
  // deixaria de fora justamente os materiais anônimos criados dentro dos
  // builders, que é onde estão tapete, estofado, luminária e livro — as
  // superfícies internas que mais denunciavam o problema.
  {
    let n = 0;
    const vistos = new Set();
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => {
        if (!m || vistos.has(m.uuid)) return;
        vistos.add(m.uuid);
        if (!m.isMeshStandardMaterial) return;
        applyIndoorOcclusion(m);
        n++;
      });
    });
    if (DEBUG) console.info('Oclusão de interior aplicada em', n, 'materiais');
  }

  BuildTrace.start('chapters-hotspots');
  BuildTrace.complete('chapters-hotspots');

  // Enquadramento inicial. A queixa recorrente nas capturas foi "céu
  // demais, terreno demais, casa pequena" — corrigido baixando a câmera,
  // aproximando, e usando FOV maior em tela vertical (onde a casa precisa
  // caber na largura, não na altura).
  const portrait = window.innerHeight > window.innerWidth;
  camera.fov = portrait ? 54 : 40;
  camera.updateProjectionMatrix();
  camera.position.set(portrait ? 15 : 17, portrait ? 7.5 : 8.5, portrait ? 14 : 15);
  controls.target.set(-1, 2.8, 1);
  targetCamPos.copy(camera.position);
  targetLookAt.copy(controls.target);

  setLightMode('day', 0.01);
  Perf.bootMs = performance.now() - _tBoot;
  if (DEBUG) {
    console.info('[perf] boot ' + Perf.bootMs.toFixed(0) + ' ms | textura procedural '
      + Perf.texturasMs.toFixed(0) + ' ms em ' + Perf.texturasN + ' geracoes');
    console.info('[perf] etapas mais caras: ' + Perf.steps.slice().sort((a, b) => b[1] - a[1])
      .slice(0, 4).map(e => e[0] + ' ' + e[1] + 'ms').join(' | '));
  }
}

// MEDIDO: 348 meshes projetando sombra. O shadow map é re-renderizado
// com todos eles a cada frame. Objetos pequenos (puxadores, livros,
// talheres decorativos) não alteram a silhueta de sombra de forma
// perceptível — desligá-los é ganho puro, sem perda visual.
// ============================================================
// FUSÃO DE GEOMETRIA ESTÁTICA — a correção nº1 de performance
// ------------------------------------------------------------
// MEDIDO no renderizador headless, capítulo "Chegada": 1201 draw calls
// para 176 mil triângulos. A conta denuncia o problema — são ~147
// triângulos por chamada. O custo não está na geometria, está no número
// de objetos: cada puxador, cada almofada, cada degrau é um Mesh, e cada
// Mesh é uma chamada de desenho separada.
//
// A solução é fundir, DENTRO de cada grupo que se move junto, todas as
// malhas estáticas que compartilham o mesmo material. O resultado é
// visualmente idêntico (mesma geometria, mesma matriz de mundo) e passa
// a ser uma chamada por material em vez de uma por objeto.
//
// O que NÃO é fundido, e por quê:
//  - InstancedMesh: já é 1 chamada, fundir seria regressão;
//  - material transparente: a ordenação por objeto é o que faz vidro,
//    água e sombra de contato aparecerem na ordem certa;
//  - qualquer objeto marcado userData.noMerge: luminárias que precisam
//    de posição própria, hotspots, e tudo que é animado;
//  - grupos que se movem sozinhos (upperMass no Modo Corte) são fundidos
//    SEPARADAMENTE, então continuam podendo subir.
// ============================================================
function mergeStaticByMaterial(root, label) {
  if (!root || !BufferGeometryUtils || !BufferGeometryUtils.mergeGeometries) return 0;

  root.updateWorldMatrix(true, true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();   // chave -> { mat, geos[], srcs[], cast, receive }

  // Percurso próprio em vez de traverse(): precisa PARAR ao encontrar
  // outro grupo que se move sozinho (userData.mergeRoot), senão o Modo
  // Corte pararia de funcionar — o volume superior seria fundido junto
  // com a arquitetura fixa e não teria mais como subir.
  const walk = (node, visit) => {
    for (const child of node.children) {
      if (child.userData && child.userData.mergeRoot) continue;
      visit(child);
      walk(child, visit);
    }
  };

  walk(root, (o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (o.userData.noMerge) return;
    // Objetos com lógica de render própria — o Water.js é o caso concreto:
    // ele renderiza a cena num render target no onBeforeRender e reflete
    // no próprio plano. Fundido, a piscina perderia a reflexão inteira.
    if (o.onBeforeRender && o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    const mat = o.material;
    if (!mat || Array.isArray(mat)) return;
    if (mat.isShaderMaterial || mat.isRawShaderMaterial) return;
    if (mat.transparent || mat.blending !== THREE.NormalBlending) return;
    if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    // um objeto invisível fundido volta a aparecer — mantém separado
    if (!o.visible) return;

    // castShadow entra na chave: fundir um caixote que projeta sombra com
    // um que não projeta obrigaria a escolher um dos dois comportamentos
    // A indexação entra na chave porque mergeGeometries() recusa um lote
    // que misture geometria indexada e não indexada — e nesse caso o
    // lote INTEIRO deixaria de ser fundido. Separando, os dois fundem.
    const key = mat.uuid + '|' + (o.castShadow ? 1 : 0) + '|' + (o.receiveShadow ? 1 : 0)
              + '|' + (o.geometry.index ? 'i' : 'n');
    let b = buckets.get(key);
    if (!b) { b = { mat, geos: [], srcs: [], cast: o.castShadow, receive: o.receiveShadow }; buckets.set(key, b); }

    const g = o.geometry.clone();
    // matriz relativa à raiz do grupo: o grupo continua podendo se mover
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld));
    // mergeGeometries exige o mesmo conjunto de atributos em todas
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    b.geos.push(g);
    b.srcs.push(o);
  });

  let saved = 0;
  buckets.forEach((b) => {
    // Um material com um objeto só não ganha nada — e removê-lo sem
    // fundir apagaria o objeto da cena. Este era o defeito a evitar aqui.
    if (b.geos.length < 2) { b.geos.forEach(g => g.dispose()); return; }
    let merged = null;
    try {
      merged = BufferGeometryUtils.mergeGeometries(b.geos, false);
    } catch (e) {
      if (DEBUG) console.warn('fusão falhou para um material, mantendo separado:', e);
    }
    b.geos.forEach(g => g.dispose());
    if (!merged) return;   // falhou: originais permanecem intactos

    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.userData.merged = true;
    root.add(mesh);
    saved += b.srcs.length - 1;
    // só agora, com o substituto na cena, os originais saem
    b.srcs.forEach((o) => {
      if (o.parent) o.parent.remove(o);
      if (o.geometry) o.geometry.dispose();
    });
  });

  if (DEBUG) console.info('fusão[' + label + ']: -' + saved + ' draw calls');
  return saved;
}

// ============================================================
// FUSÃO DAS SOMBRAS DE CONTATO
// ------------------------------------------------------------
// A fusão estática recusa material transparente de propósito: a ordenação
// por objeto é o que faz vidro e água aparecerem na ordem certa. Sombra de
// contato é a exceção legítima, e por um motivo específico: o blend delas
// é MULTIPLICAÇÃO, que é comutativa. dst*a*b dá o mesmo que dst*b*a, então
// a ordem entre elas não existe — e todas usam o mesmo material.
//
// 27 planos viram 1 mesh. Não é aproximação: o resultado é idêntico.
// ============================================================
function mergeContactShadows(root) {
  if (!root || !BufferGeometryUtils || !BufferGeometryUtils.mergeGeometries) return 0;
  root.updateWorldMatrix(true, true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const alvos = [];
  root.traverse((o) => { if (o.isMesh && o.userData.contactShadow) alvos.push(o); });
  if (alvos.length < 2) return 0;

  const geos = alvos.map((o) => {
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld));
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  });
  let merged = null;
  try { merged = BufferGeometryUtils.mergeGeometries(geos, false); }
  catch (e) { if (DEBUG) console.warn('fusão de sombras de contato falhou:', e); }
  geos.forEach((g) => g.dispose());
  if (!merged) return 0;

  const mesh = new THREE.Mesh(merged, alvos[0].material);
  mesh.renderOrder = 1;
  mesh.userData.merged = true;
  mesh.userData.contactShadow = true;
  mesh.frustumCulled = false;   // cobre a casa inteira; culling não ajuda
  root.add(mesh);
  const n = alvos.length;
  alvos.forEach((o) => {
    if (o.parent) o.parent.remove(o);
    if (o.geometry) o.geometry.dispose();
  });
  if (DEBUG) console.info('sombras de contato: ' + n + ' meshes -> 1');
  return n - 1;
}

// IDEMPOTENTE de propósito.
//
// A versão anterior só sabia DESLIGAR: ela pulava tudo que já estava com
// castShadow false (`if (!o.castShadow) return`). Rodar de novo depois de
// subir o tier — o que acontece com ?q=ultra numa sessão já iniciada, e
// aconteceria em qualquer futuro upgrade dinâmico de qualidade — não
// devolvia sombra a nada: o limiar de low tinha desligado 181 objetos e
// eles ficavam desligados para sempre.
//
// Agora a decisão é recalculada dos dois lados, a partir do estado
// original guardado em userData.castShadowOriginal. Rodar N vezes com o
// mesmo tier dá o mesmo resultado; rodar com tier maior devolve o que
// aquele tier merece.
function optimizeShadowCasters() {
  let off = 0, kept = 0;
  houseGroup.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.castShadowOriginal === undefined) o.userData.castShadowOriginal = o.castShadow;
    if (!o.userData.castShadowOriginal) return;   // nunca projetou, não passa a projetar
    o.castShadow = true;                          // parte do original e reavalia
    if (o.isInstancedMesh) { kept++; return; }
    let base = o.userData.maxDim;
    if (base === undefined && o.geometry && o.geometry.parameters) {
      const q = o.geometry.parameters;
      base = Math.max(q.width || 0, q.height || 0, q.depth || 0,
                      (q.radius || 0) * 2, (q.radiusBottom || 0) * 2, (q.outerRadius || 0) * 2);
    }
    if (!base) { kept++; return; }
    const maxDim = base * Math.max(o.scale.x, o.scale.y, o.scale.z);
    // limiar por tier: em aparelhos fracos, só a arquitetura e os móveis
    // grandes projetam sombra
    const thr = { ultra: 0.40, high: 0.55, medium: 0.90, low: 1.60 }[Quality.level] || 0.55;
    if (maxDim < thr) { o.castShadow = false; off++; }
    else kept++;
  });
  if (DEBUG) console.info('Sombras: desligadas em ' + off + ' objetos pequenos, mantidas em ' + kept);
}

function buildChaptersAndHotspots() {
  // CÂMERAS REVISADAS — cada alvo é agora algo que a câmera realmente
  // consegue VER. Auditado por auditar-visao.js contra cada parede e laje
  // opaca individualmente (o auditor antigo só testava a caixa da casa,
  // e por isso deixou passar câmeras encarando parede).
  // Os capítulos vivem em src/data/chapters.json — ver o comentário do LP:
  // uma fonte só, editável sem tocar em código.
  CONFIG.chapters = _CAPITULOS_JSON.capitulos;

  CONFIG.hotspots = [
    { pos: [-4.15, 2.2, 6.3], title: 'Fachada em Estuque', desc: 'Volume térreo revestido em estuque claro.' },
    { pos: [3.4, 3.4, -2.4], title: 'Núcleo em Pedra', desc: 'Elemento vertical que organiza a circulação entre as alas — detalhe construtivo central do projeto.' },
    { pos: [0.4, 4.05, 4.5], title: 'Forro em Cumaru', desc: 'Madeira natural no forro do balanço, com iluminação embutida.' },
    { pos: [-8.6, 1.0, -1.2], title: 'Sala de Estar', desc: 'Estar integrado com vista para a piscina.' },
    { pos: [0.4, 1.3, 0.9], title: 'Cozinha', desc: 'Ilha em bancada de pedra, com banquetas.' },
    { pos: [6.7, 1.1, -0.8], title: 'Suíte Master', desc: 'Cama de casal com bancada e banheira em suíte.' },
    { pos: [-5.2, 0.35, 10.4], title: 'Piscina', desc: 'Borda infinita voltada para o jardim.' },
    { pos: [1.2, 1.2, 10.4], title: 'Área Gourmet', desc: 'Pergolado, mesa externa e churrasqueira integrados ao deck.' },
    { pos: [-9.5, 1.6, -9], title: 'Paisagismo', desc: 'Vegetação de porte médio ao longo do perímetro.' },
    { pos: [0.4, 3.85, 0], title: 'Sustentabilidade', desc: 'Balanço solar controlado pelo próprio parapeito, ventilação cruzada entre as duas fachadas de vidro.' },
  ];
}

// ============================================================
// HOTSPOTS
// Raio dos marcadores em escala real (metros) — o modelo real tem ~30m de
// planta, então os 0.1 unidades de uma casa-brinquedo não apareceriam.
// ============================================================
function buildHotspots() {
  // CORRIGIDO APÓS INSPEÇÃO VISUAL: em 0.32 de raio com material básico
  // (não afetado por luz), os marcadores viravam esferas enormes e
  // estouradas que dominavam quase todos os enquadramentos do tour —
  // bloqueando justamente a arquitetura que deveriam apontar.
  const geo = new THREE.SphereGeometry(0.10, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xC4A574, transparent: true, opacity: 0.55 });

  CONFIG.hotspots.forEach((hs, i) => {
    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.position.set(hs.pos[0], hs.pos[1], hs.pos[2]);
    mesh.userData = { title: hs.title, desc: hs.desc, id: i };
    scene.add(mesh);
    hotspotMeshes.push(mesh);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.21, 18),
      new THREE.MeshBasicMaterial({ color: 0xC4A574, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    ring.position.set(hs.pos[0], hs.pos[1], hs.pos[2]);
    ring.lookAt(camera.position);
    ring.userData = { isRing: true, parentId: i };
    scene.add(ring);
    hotspotMeshes.push(ring);
  });
}

// ============================================================
// NAV DOTS
// ============================================================
function buildNavDots() {
  const c = $('nav-dots');
  c.innerHTML = '';
  CONFIG.chapters.forEach((ch, i) => {
    const b = document.createElement('button');
    b.className = 'nav-dot' + (i === 0 ? ' active' : '');
    b.setAttribute('aria-label', ch.title);
    b.addEventListener('click', () => goToChapter(i));
    c.appendChild(b);
  });
}

function updateDots() {
  document.querySelectorAll('.nav-dot').forEach((d, i) => {
    d.classList.toggle('active', i === currentChapter);
  });
}

// ============================================================
// CHAPTERS — CÂMERA CINEMATOGRÁFICA
// ============================================================
// ============================================================
// MODO CORTE — a "maquete que abre"
// Ergue o volume superior (laje de cobertura + pavimento em balanço)
// revelando a planta do térreo, como uma maquete física de arquiteto que
// se desmonta em camadas. Além do efeito, é comercialmente útil: o
// corretor mostra a distribuição dos ambientes sem sair do 3D.
// ============================================================
function toggleReveal(force) {
  revealActive = (force === undefined) ? !revealActive : force;
  revealTarget = revealActive ? 1 : 0;
  const btn = $('btn-reveal');
  if (btn) {
    btn.classList.toggle('active', revealActive);
    btn.textContent = revealActive ? 'Fechar Corte' : 'Modo Corte';
  }
  // ao abrir o corte, sobe um pouco a câmera para ver a planta
  if (revealActive && Experience.is('explore')) {
    targetCamPos.set(4, 13.5, 15);
    targetLookAt.set(-1, 1.2, 1);
    camCurve = null;
    revealCamMove = true;
    controls.enabled = false; // evita briga com o OrbitControls durante o voo
  }
}

function updateReveal(dt) {
  if (!upperMass) return;
  if (Math.abs(revealAmount - revealTarget) < 0.001) { revealAmount = revealTarget; return; }
  const speed = Capability.reducedMotion ? 1 : Math.min(1, dt * 2.2);
  revealAmount += (revealTarget - revealAmount) * speed;
  const e = revealAmount < 0.5
    ? 2 * revealAmount * revealAmount
    : 1 - Math.pow(-2 * revealAmount + 2, 2) / 2;
  upperMass.position.y = e * 7.2;
}

// ============================================================
// TRANSIÇÃO DE CÂMERA COM CONSCIÊNCIA DO EDIFÍCIO
// ------------------------------------------------------------
// CAUSA RAIZ do bug de atravessar parede: a curva anterior era uma
// Catmull-Rom de 3 pontos entre origem e destino, sem nenhuma noção de
// onde a casa está. Uma transição da Entrada (fora, ao norte) para a
// Sala (dentro) desenhava uma reta cruzando o edifício inteiro. Pior:
// `modelBounds` era null, então o desvio vertical virava 1,2 m — na
// prática, uma linha reta.
//
// SOLUÇÃO: antes de voar, testa se o segmento origem→destino cruza o
// envelope construído. Se cruzar, NÃO voa — faz um corte com fade, que
// é como apresentações imobiliárias profissionais realmente fazem
// (vídeos de imóvel cortam entre ambientes, não atravessam paredes).
// Assim atravessar parede deixa de ser improvável e passa a ser
// estruturalmente impossível.
// ============================================================

// Envelope construído (AABB), com folga de segurança
const HOUSE_ENVELOPE = { minX: -13.4, maxX: 12.4, minY: -0.2, maxY: 7.0, minZ: -6.4, maxZ: 6.3 };

function pointInEnvelope(p, pad) {
  const e = HOUSE_ENVELOPE, k = pad || 0;
  return p.x > e.minX - k && p.x < e.maxX + k &&
         p.y > e.minY - k && p.y < e.maxY + k &&
         p.z > e.minZ - k && p.z < e.maxZ + k;
}

// Teste segmento × AABB (método dos slabs)
function segmentHitsEnvelope(a, b) {
  const e = HOUSE_ENVELOPE;
  let t0 = 0, t1 = 1;
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const axes = [
    [a.x, d.x, e.minX, e.maxX],
    [a.y, d.y, e.minY, e.maxY],
    [a.z, d.z, e.minZ, e.maxZ],
  ];
  for (const [start, delta, mn, mx] of axes) {
    if (Math.abs(delta) < 1e-8) {
      if (start < mn || start > mx) return false; // paralelo e fora
      continue;
    }
    let tA = (mn - start) / delta;
    let tB = (mx - start) / delta;
    if (tA > tB) { const tmp = tA; tA = tB; tB = tmp; }
    t0 = Math.max(t0, tA);
    t1 = Math.min(t1, tB);
    if (t0 > t1) return false;
  }
  return true;
}

// Decide entre voo suave e corte
function transitionNeedsCut(from, to) {
  const fromIn = pointInEnvelope(from);
  const toIn = pointInEnvelope(to);
  // ambos dentro: só voa se for perto e na mesma ala (sem parede no meio)
  if (fromIn && toIn) {
    const dist = from.distanceTo(to);
    const sameWing = (from.x < 3.4) === (to.x < 3.4); // núcleo de pedra em x≈3.4
    return !(dist < 6 && sameWing);
  }
  // um dentro e outro fora: sempre atravessaria fachada → corte
  if (fromIn !== toIn) return true;
  // ambos fora: só corta se a reta cruzar o edifício
  return segmentHitsEnvelope(from, to);
}

function doFadeCut(applyFn) {
  const fade = $('fade-cut');
  if (!fade || Capability.reducedMotion) { applyFn(); return; }
  fade.classList.add('on');
  Experience.setTimeout(() => {
    applyFn();
    Experience.setTimeout(() => fade.classList.remove('on'), 60);
  }, 300);
}

function goToChapter(idx, showUI) {
  if (showUI === undefined) showUI = true;
  if (idx < 0 || idx >= CONFIG.chapters.length) return;
  currentChapter = idx;
  const ch = CONFIG.chapters[idx];

  targetCamPos.set(ch.cam.pos[0], ch.cam.pos[1], ch.cam.pos[2]);
  targetLookAt.set(ch.cam.look[0], ch.cam.look[1], ch.cam.look[2]);

  const startPos = camera.position.clone();
  const endPos = targetCamPos.clone();

  // ------------------------------------------------------------
  // BUG ENCONTRADO SONDANDO, e ele quebrava a navegação principal.
  //
  // Medido chamando goToChapter(4) ("Sala de Estar") com a experiência em
  // `ready`, que é o estado de quem está orbitando à vontade:
  //
  //   t~4s   câmera (17 / 8,5 / 15)      — 29,0 m do alvo
  //   t~10s  câmera (-8,6 / 1,6 / 3,2)   —  0,0 m   <- chegou
  //   t~20s  câmera (17 / 8,5 / 15)      — 29,0 m   <- EXPULSA
  //
  // O corte põe a câmera dentro da sala, e no quadro seguinte
  // `clampFreeCamera()` vê "está dentro do envelope agora, estava fora
  // antes" e devolve `_camPrev`. O cliente clica "Sala de Estar", vê um
  // fade, um piscar do interior, e volta para a vista aérea.
  //
  // A proteção está CERTA no que ela existe para fazer: impedir que o
  // dedo arraste a câmera através da fachada. Ela só não sabe distinguir
  // isso de um salto deliberado. Duas correções, uma para cada caminho:
  //
  //  - CORTE: a posição nova é válida por definição, então ela vira o
  //    `_camPrev`. Sem isso o teste "veio de fora" dispara para sempre.
  //  - VOO: `lerpCam()` só é chamado em cinematic/presenting/reveal, ou
  //    seja, um capítulo com trajetória livre clicado em `ready` não
  //    movia a câmera NENHUM metro. Ganha a mesma flag que o reveal já
  //    tinha, e devolve o controle ao chegar.
  //
  // A apresentação guiada nunca sofreu disso porque roda em `presenting`,
  // que a guarda isenta — por isso o defeito sobreviveu à verificação do
  // Modo Apresentação.
  if (transitionNeedsCut(startPos, endPos)) {
    // CORTE: a trajetória cruzaria o edifício. Reposiciona atrás do fade.
    camCurve = null;
    doFadeCut(() => {
      camera.position.copy(endPos);
      controls.target.copy(targetLookAt);
      camera.lookAt(targetLookAt);
      _camPrev.copy(endPos);
    });
  } else {
    chapterCamMove = true;
    // VOO: caminho livre. O ponto médio sobe acima da cobertura para dar
    // um arco cinematográfico — e nunca rasante ao telhado.
    const midPos = startPos.clone().lerp(endPos, 0.5);
    const bothOutside = !pointInEnvelope(startPos) && !pointInEnvelope(endPos);
    midPos.y += bothOutside ? 2.4 : 0.35;
    if (bothOutside) midPos.y = Math.max(midPos.y, HOUSE_ENVELOPE.maxY + 1.2);
    camCurve = new THREE.CatmullRomCurve3([startPos, midPos, endPos]);
    camCurveT = 0;
    camCurveTarget = 1;
  }

  const total = String(CONFIG.chapters.length).padStart(2, '0');
  const tag = $('ch-tag');
  tag.textContent = String(idx + 1).padStart(2, '0') + ' / ' + total;

  $('ch-eyebrow').textContent = 'Capítulo ' + String(idx + 1).padStart(2, '0');
  $('ch-title').textContent = ch.title;
  $('ch-desc').textContent = ch.desc;

  if (showUI) {
    const overlay = $('ch-overlay');
    overlay.classList.add('visible');
    Experience.setTimeout(() => overlay.classList.remove('visible'), 3500);
  }

  updateDots();
  if (ch.light && ch.light !== currentLightMode) {
    setLightMode(ch.light);
  }
}

function lerpCam(dt) {
  const speed = 1.2 * dt;
  if (camCurve && camCurveT < camCurveTarget) {
    camCurveT += dt * 0.4;
    if (camCurveT > camCurveTarget) camCurveT = camCurveTarget;
    const e = camCurveT < 0.5 ? 2 * camCurveT * camCurveT : 1 - Math.pow(-2 * camCurveT + 2, 2) / 2;
    camera.position.copy(camCurve.getPointAt(e));
  } else {
    camera.position.lerp(targetCamPos, speed);
  }
  controls.target.lerp(targetLookAt, speed);
}

// ============================================================
// MODO CINEMÁTICO
// ============================================================
function runCinematic() {
  if (Experience.is('cinematic')) return;
  Experience.set('cinematic');
  const token = Experience.startCinematic();
  $('hero').classList.add('hidden');
  controls.enabled = false;

  let i = 0;
  function step() {
    if (!Experience.isCurrentCinematic(token)) return;
    if (i >= CONFIG.chapters.length) {
      Experience.set('commercial');
      showCommercial();
      return;
    }
    goToChapter(i, true);
    i++;
    Experience.setTimeout(step, 4500);
  }
  step();
}

function showCommercial() {
  $('commercial').classList.add('visible');
  $('ch-overlay').classList.remove('visible');
  pauseRenderLoop();
}

function hideCommercial() {
  $('commercial').classList.remove('visible');
  resumeRenderLoop();
  // Bug real encontrado em auditoria: se o cinematic mode chega ao fim
  // sozinho (sem o usuário clicar pra interromper), controls.enabled nunca
  // era religado — a pessoa ficava com a câmera travada depois de fechar
  // esta tela. Fechar o comercial sempre devolve um estado explorável.
  controls.enabled = true;
  document.body.dataset.mode = 'explore';
  Experience.set('explore');
}

// ============================================================
// MODO APRESENTAÇÃO
// ============================================================
function enterPresent() {
  Experience.stopCinematic();
  Experience.set('presenting');
  document.body.dataset.mode = 'present';
  $('hero').classList.add('hidden');
  controls.enabled = false;
  goToChapter(0, true);
}

function exitPresent() {
  Experience.set('explore');
  document.body.dataset.mode = 'explore';
  controls.enabled = true;
  $('ch-overlay').classList.remove('visible');
}

function nextCh() {
  if (currentChapter < CONFIG.chapters.length - 1) {
    goToChapter(currentChapter + 1, true);
  } else {
    showCommercial();
  }
}

function prevCh() {
  if (currentChapter > 0) goToChapter(currentChapter - 1, true);
}

function wireWhatsappCTA() {
  const wa = $('cta-whatsapp');
  if (!wa) return;
  // Permite configurar o contato pela URL (?wa=5561999999999) — assim o
  // corretor publica o arquivo com o próprio número sem editar código.
  // Nenhum dado de contato é inventado: sem configuração, o botão some.
  let num = CONFIG.whatsappThiago;
  const p = new URLSearchParams(location.search).get('wa');
  if (p && /^\d{10,15}$/.test(p)) num = p;

  if (num && num !== '5561900000000') {
    wa.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent('Ola, vi a experiencia da Casa Aura e gostaria de saber mais.');
    wa.style.display = '';
  } else {
    wa.style.display = 'none';
    // sem contato configurado, o bloco final se fecha com a chamada de
    // texto — o cliente nunca vê um espaço vazio pendurado
    const holder = wa.parentElement;
    if (holder) holder.style.display = 'none';
    if (DEBUG) console.warn('Casa Aura: CTA oculto — configure o contato em CONFIG.whatsappThiago ou via ?wa=NUMERO');
  }
}

function setupSolarTrack() {
  const track = $('solar-track');
  if (!track) return;

  const applyFromClientX = (clientX) => {
    const r = track.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
    solarAnimId++; // cancela qualquer transição animada em andamento
    applySolarTime(t);
  };

  track.addEventListener('pointerdown', (e) => {
    solarDragging = true;
    track.classList.add('dragging');
    if (track.setPointerCapture) { try { track.setPointerCapture(e.pointerId); } catch (err) {} }
    applyFromClientX(e.clientX);
    e.stopPropagation();
  });
  track.addEventListener('pointermove', (e) => {
    if (!solarDragging) return;
    applyFromClientX(e.clientX);
    e.stopPropagation();
  });
  const endDrag = () => { solarDragging = false; track.classList.remove('dragging'); };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('pointerleave', endDrag);

  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.10 : 0.02;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { solarAnimId++; applySolarTime(solarTime + step); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { solarAnimId++; applySolarTime(solarTime - step); e.preventDefault(); }
    if (e.key === 'Home') { solarAnimId++; applySolarTime(0); e.preventDefault(); }
    if (e.key === 'End') { solarAnimId++; applySolarTime(1); e.preventDefault(); }
  });
}

function setupEvents() {
  let resizePending = false, lastW = window.innerWidth, lastH = window.innerHeight;
  const doResize = () => {
    resizePending = false;
    const w = window.innerWidth, h = window.innerHeight;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    camera.aspect = w / h;
    camera.fov = (h > w) ? 54 : 40;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (composer) composer.setSize(w, h);
  };
  const scheduleResize = () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(doResize);
  };
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);
  if ('ResizeObserver' in window) new ResizeObserver(scheduleResize).observe(container);

  $('btn-cinematic').addEventListener('click', runCinematic);
  $('btn-explore').addEventListener('click', () => {
    $('hero').classList.add('hidden');
    controls.enabled = true;
    Experience.set('explore');
    goToChapter(0, false);
  });

  document.querySelectorAll('.light-btn').forEach(b => {
    b.addEventListener('click', () => setLightMode(b.dataset.light));
  });

  $('btn-present').addEventListener('click', enterPresent);
  $('btn-reveal').addEventListener('click', () => toggleReveal());
  $('btn-exit-present').addEventListener('click', exitPresent);
  $('btn-next').addEventListener('click', nextCh);
  $('btn-prev').addEventListener('click', prevCh);
  $('comm-close').addEventListener('click', hideCommercial);

  window.addEventListener('keydown', e => {
    if (Experience.is('presenting')) {
      if (e.key === 'ArrowRight') nextCh();
      if (e.key === 'ArrowLeft') prevCh();
      if (e.key === 'Escape') exitPresent();
    }
  });

  let tsY = 0;
  window.addEventListener('touchstart', e => { tsY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchend', e => {
    const dy = tsY - e.changedTouches[0].clientY;
    if (Math.abs(dy) > 50 && Experience.is('presenting')) { dy > 0 ? nextCh() : prevCh(); }
  }, { passive: true });

  window.addEventListener('pointerdown', onPointerDown);

  wireWhatsappCTA();
  setupSolarTrack();

  // Áudio: inicializado só na primeira interação real (autoplay policy)
  audioSys = createAudioSystem();
  const initAudioOnce = () => { audioSys.init(); window.removeEventListener('pointerdown', initAudioOnce); };
  window.addEventListener('pointerdown', initAudioOnce);
  const ab = $('btn-audio');
  if (ab) ab.addEventListener('click', () => {
    const on = audioSys.toggle();
    ab.classList.toggle('active', on);
    ab.textContent = on ? 'Som ligado' : 'Som';
  });
}

function onPointerDown(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const hits = raycaster.intersectObjects(hotspotMeshes.filter(m => m.userData.id !== undefined));
  if (hits.length > 0) {
    showHS(hits[0].object.userData, e.clientX, e.clientY);
  } else {
    hideHS();
  }

  if (Experience.is('cinematic')) {
    Experience.stopCinematic();
    controls.enabled = true;
  }
}

function showHS(data, x, y) {
  const el = $('hs-label');
  el.querySelector('.hst').textContent = data.title;
  el.querySelector('.hsd').textContent = data.desc;
  el.style.left = Math.min(x + 14, window.innerWidth - 246) + 'px';
  el.style.top = Math.min(y + 14, window.innerHeight - 120) + 'px';
  el.classList.add('visible');
  Experience.setTimeout(hideHS, 4500);
}

function hideHS() {
  $('hs-label').classList.remove('visible');
}

// ============================================================
// VISIBILITY / RENDER-LOOP LIFECYCLE
// ============================================================
function pauseRenderLoop() {
  renderLoopActive = false;
  renderer.setAnimationLoop(null);
}
function resumeRenderLoop() {
  if (renderLoopActive) return;
  renderLoopActive = true;
  clock.getDelta();
  renderer.setAnimationLoop(animate);
}
function startRenderLoop() {
  renderLoopActive = true;
  renderer.setAnimationLoop(animate);
}
function setupVisibilityHandling() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseRenderLoop();
    else if (!$('commercial').classList.contains('visible')) resumeRenderLoop();
  });
}

// ============================================================
// DEBUG PANEL (?debug=1)
// ============================================================
function setupDebugPanel() {
  const el = $('debug-panel');
  el.classList.add('show');
  el.style.whiteSpace = 'pre';
  el.style.maxWidth = '54vw';
  let ftMin = 999, ftMax = 0, ftSum = 0, ftN = 0;
  setInterval(() => {
    const info = renderer.info;
    const ft = currentFPS > 0 ? (1000 / currentFPS) : 0;
    if (ft > 0) { ftMin = Math.min(ftMin, ft); ftMax = Math.max(ftMax, ft); ftSum += ft; ftN++; }
    const stepsLine = BuildTrace.completedSteps.length
      ? BuildTrace.completedSteps.length + '/11 etapas'
      : '(construindo)';
    const failLine = BuildTrace.failedStep
      ? `\nFALHOU EM: ${BuildTrace.failedStep}\n${BuildTrace.error ? BuildTrace.error.constructor.name + ': ' + BuildTrace.error.message : ''}`
      : '';
    el.textContent =
      `FPS ${currentFPS}   frame ${ft.toFixed(1)}ms\n` +
      `frame min/med/max ${ftMin === 999 ? '-' : ftMin.toFixed(1)}/${ftN ? (ftSum / ftN).toFixed(1) : '-'}/${ftMax.toFixed(1)}ms\n` +
      `quality ${Quality.level}   dpr ${renderer.getPixelRatio().toFixed(2)}\n` +
      `res ${Math.round(window.innerWidth * renderer.getPixelRatio())}x${Math.round(window.innerHeight * renderer.getPixelRatio())}\n` +
      `draw calls ${info.render.calls}   tris ${info.render.triangles}\n` +
      `geo ${info.memory.geometries}   tex ${info.memory.textures}\n` +
      `luzes reais ${lampLights.length + 3}   emissivas ${emissiveFixtures.length}\n` +
      `sombras ${renderer.shadowMap.enabled ? 'on' : 'off'}   state ${Experience.state}\n` +
      `${stepsLine}` + failLine;
  }, 400);
}


// ============================================================
// ANIMATE
// ============================================================
function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.getElapsedTime();

  if (Experience.is('cinematic') || Experience.is('presenting')) {
    lerpCam(dt);
  } else if (revealCamMove || chapterCamMove) {
    lerpCam(dt);
    // termina o voo quando chega perto e devolve o controle ao usuário
    if (camera.position.distanceTo(targetCamPos) < 0.35) {
      revealCamMove = false;
      chapterCamMove = false;
      controls.target.copy(targetLookAt);
      controls.enabled = true;
    }
  }

  const animateDecor = !Capability.reducedMotion && Quality.get().waterAnim;

  // Ondulação real: desloca o normal map da água em duas direções com
  // velocidades diferentes. Antes isto era um pulso de opacidade, que não
  // parece água — parecia a piscina piscando.
  if (waterNormalMap && animateDecor) {
    waterNormalMap.offset.x = (time * 0.013) % 1;
    waterNormalMap.offset.y = (time * 0.021) % 1;
  }

  // Durante cinematic/apresentação os marcadores desaparecem: ali a
  // composição é fotografia arquitetônica, não interface.
  const hsVisible = !(Experience.is('cinematic') || Experience.is('presenting'));
  hotspotMeshes.forEach(m => {
    m.visible = hsVisible;
    if (m.userData.isRing) {
      if (animateDecor) {
        const s = 1 + Math.sin(time * 2.5 + m.userData.parentId) * 0.2;
        m.scale.setScalar(s);
      }
      m.lookAt(camera.position);
    }
  });

  // Regenera o environment a partir do céu quando o sol andou o
  // suficiente. Feito fora do laço de arraste para não custar por frame.
  // ------------------------------------------------------------
  // ORÇAMENTO DO PMREM
  // Gerar o mapa de ambiente é 6 faces de cubemap mais a cadeia de
  // convolução. Durante o ARRASTE do slider solar o sol anda continuamente,
  // e sem freio isso dispara uma geração a cada poucos quadros — que é
  // exatamente quando o usuário está olhando e mexendo, o pior momento
  // possível para um engasgo.
  //
  // Uma geração a cada 900 ms, no máximo. Entre elas o mapa fica um pouco
  // atrasado em relação ao céu, e isso não se vê: o que muda é a cor do
  // preenchimento indireto, não a geometria nem o sol direto. O que se vê
  // é o engasgo.
  //
  // A última geração é sempre agendada: se o arraste parar entre dois
  // orçamentos, envDirty continua ligado e o próximo quadro elegível
  // acerta o céu final. Sem isso o mapa poderia ficar preso no horário
  // errado ao soltar o slider.
  if (envDirty && sky && skyPMREM && (performance.now() - _ultimoPMREM) > PMREM_MS) {
    _ultimoPMREM = performance.now();
    envDirty = false;
    try {
      const prev = envRT;
      // ------------------------------------------------------------
      // O DISCO SOLAR FORA DO IBL
      // MEDIDO: 5,1% dos pixels estourados e desvio de azul B-R = +18,6.
      // Causa: fromScene(sky) capturava o DISCO DO SOL junto com o céu.
      // O disco é ordens de grandeza mais brilhante que o resto da
      // abóbada, então o mapa de ambiente passava a carregar a energia
      // do sol — que já está sendo entregue pela DirectionalLight. A luz
      // do sol entrava duas vezes, e a segunda vez sem direção nenhuma:
      // preenchimento azulado forte em tudo, inclusive nas faces em
      // sombra, que é exatamente o defeito visto nas capturas.
      //
      // Correção: suprime o termo de Mie (o que concentra o disco)
      // durante a geração do mapa e restaura depois. O IBL passa a ser
      // só a abóbada; o sol continua vindo da luz direcional.
      const u = sky.material.uniforms;
      const mieC = u.mieCoefficient.value, mieG = u.mieDirectionalG.value;
      u.mieCoefficient.value = 0.0005;
      u.mieDirectionalG.value = 0.0;

      // ------------------------------------------------------------
      // O CHÃO DENTRO DO MAPA DE AMBIENTE
      // Segundo defeito da mesma família: fromScene(sky) só via o CÉU.
      // Metade de baixo do mapa de ambiente ficava com o azul escuro da
      // abóbada abaixo do horizonte, ou seja, o IBL não tinha nenhum
      // rebote de solo. Uma parede vertical integrava um hemisfério
      // inteiramente azul — e por isso toda superfície em sombra saía
      // fria, por mais que se mexesse na hemisférica.
      //
      // No mundo real é o gramado e o travertino que devolvem luz quente
      // para as sombras. Aqui isso vira uma calota abaixo do horizonte,
      // com a cor de solo da parada atmosférica atual, incluída só na
      // geração do mapa — não aparece na cena.
      // ------------------------------------------------------------
      // O GANHO DA CALOTA — segunda rodada, medida.
      //
      // A calota existia e mesmo assim as paredes em sombra continuavam
      // frias: na "Chegada", desvio B−R de +20,7 e +29,2, enquanto o resto
      // da cena lia quente (−16 a −20). Aquelas paredes são quase 100%
      // IBL, então o desvio delas É o desvio do mapa de ambiente.
      //
      // A causa é de unidade, não de cor. A abóbada do Preetham é HDR e
      // chega a valores bem acima de 1,0 perto do horizonte; a calota era
      // um MeshBasicMaterial com uma cor sRGB, ou seja, teto 1,0. O
      // hemisfério inferior entrava ordens de grandeza mais fraco que o
      // superior, e a parede vertical — que integra metade de cada —
      // acabava lendo só o céu.
      //
      // Rebote de solo no mundo real é ILUMINÂNCIA DO CÉU vezes albedo do
      // solo: quanto mais claro o dia, mais forte o rebote. Por isso o
      // ganho multiplica a cor em espaço linear em vez de trocá-la.
      const skyParent = sky.parent;
      envScene.add(sky);
      envGround.material.color.copy(solarStateAt(solarTime).hemiGnd)
        .multiplyScalar(envGroundGain.value);
      envRT = skyPMREM.fromScene(envScene);
      if (skyParent) skyParent.add(sky);

      u.mieCoefficient.value = mieC;
      u.mieDirectionalG.value = mieG;
      scene.environment = envRT.texture;
      if (prev && prev.dispose) prev.dispose();
    } catch (e) { if (DEBUG) console.warn('PMREM do céu falhou:', e); }
  }
  // (a ondulação da água vem do offset do normal map, logo acima)

  // Gancho ANTES do render, com dt. E onde entram os modulos tipados que
  // escrevem no que sera desenhado neste quadro: diretor de camera,
  // uniforms de agua, feixes volumetricos, particulas, foco. Se rodassem
  // depois do render, tudo apareceria com um quadro de atraso — visivel
  // como tremor durante o modo cinematico.
  const ganchosAntes = (window as any).__auraAntesDoQuadro;
  if (ganchosAntes) { for (let i = 0; i < ganchosAntes.length; i++) ganchosAntes[i](dt); }

  updateReveal(dt);
  // OrbitControls.update() NAO respeita `enabled` — a checagem de
  // `enabled` existe so nos handlers de evento. O update em si recalcula
  // a posicao a partir do esferico E faz `object.lookAt(target)`, ou
  // seja, sobrescreve tudo que o diretor de camera escreveu no quadro.
  // Enquanto ele conduz, o orbit fica de fora do laco.
  if (!window.__auraCameraTravada) controls.update();
  clampFreeCamera();
  if (grainPass) grainPass.uniforms.time.value = time;
  if (!Capability.reducedMotion) windUniform.value = time;
  // DEFENSIVO: não consegui validar o pós-processamento renderizando —
  // o UnrealBloomPass exige WebGL 2 e meu renderizador headless é
  // WebGL 1.0. Como não posso provar que compila em todo aparelho, se
  // qualquer passe falhar a experiência cai para render direto em vez de
  // ficar preta. Falhar bonito > falhar invisível.
  if (composer && !composerFailed) {
    try { composer.render(); }
    catch (e) {
      composerFailed = true;
      if (DEBUG) console.warn('Pós-processamento desativado após falha:', e);
      renderer.render(scene, camera);
    }
  } else {
    renderer.render(scene, camera);
  }

  // Gancho por quadro para os modulos TIPADOS (QualityController etc.).
  // E um ponto de extensao para a migracao: quem foi esculpido para fora
  // do legado se pendura aqui em vez de o legado importar de volta, o que
  // criaria dependencia circular.
  const ganchos = (window as any).__auraPorQuadro;
  if (ganchos) { for (let i = 0; i < ganchos.length; i++) ganchos[i](); }

  frameCount++;
  const now = performance.now();
  // Média móvel do tempo de quadro. Serve ao painel de debug e ao
  // rebaixamento — os dois lendo a MESMA fonte, para não divergirem.
  Perf.frameMs = Perf.frameMs
    ? Perf.frameMs * 0.9 + (now - _tQuadroAnterior) * 0.1
    : (now - _tQuadroAnterior);
  _tQuadroAnterior = now;
  Perf.quadros++;

  if (now - lastFrameTime >= 1000) {
    currentFPS = Math.round((frameCount * 1000) / (now - lastFrameTime));
    frameCount = 0; lastFrameTime = now;
    if (Perf.quadros > 120) {
      Perf.piorFps = (Perf.piorFps === null) ? currentFPS : Math.min(Perf.piorFps, currentFPS);
    }
    if (DEBUG && Perf.quadros > 60) {
      console.info('[perf] ' + currentFPS + ' fps | quadro ' + Perf.frameMs.toFixed(1) + ' ms | '
        + renderer.info.render.calls + ' draw | ' + renderer.info.programs.length + ' programas');
    }
    // ------------------------------------------------------------
    // LIMIAR DE REBAIXAMENTO
    // Era: menos de 24 fps por TRÊS segundos seguidos. Para um produto
    // que promete fluidez, isso é nove segundos de experiência ruim
    // antes de qualquer reação, e 24 fps já é travado o bastante para o
    // cliente fechar a aba.
    //
    // Agora: menos de 45 fps por dois segundos seguidos. O alvo é 60; 45
    // é a fronteira onde o arraste da câmera começa a arrastar de
    // verdade. Os dois primeiros segundos ficam de fora — ali ainda há
    // compilação de shader e upload de textura, e rebaixar por causa do
    // boot puniria o aparelho errado.
    const emBoot = Perf.quadros < 120;
    if (!emBoot && currentFPS < 45) {
      slowFrameStreak++;
      if (slowFrameStreak >= 2) {
        slowFrameStreak = 0;
        // O rebaixamento do legado fica DESLIGADO quando o
        // QualityController tipado esta no comando. Os dois mexem em
        // `setPixelRatio`: o legado o reescrevia a partir do tier e
        // desfazia em silencio o degrau mais barato que o controlador
        // achava ter aplicado — que e justamente o degrau que devolve
        // mais desempenho.
        if (!window.__auraQualidadeAssumida && Quality.downgrade()) applyQualityDowngrade();
      }
    } else {
      slowFrameStreak = 0;
    }
  }
}

// Exploração livre: impede o cliente de acabar embaixo do piso ou com a
// câmera enfiada dentro de uma parede — o equivalente do bug de cinematic
// no modo manual.
const _camPrev = new THREE.Vector3();
function clampFreeCamera() {
  if (Experience.is('cinematic') || Experience.is('presenting')
      || revealCamMove || chapterCamMove) {
    _camPrev.copy(camera.position);
    return;
  }
  let fixed = false;
  if (camera.position.y < 0.45) { camera.position.y = 0.45; fixed = true; }
  // se entrou no envelope construído vindo de fora, devolve para a posição
  // anterior válida (evita atravessar fachada com o dedo na tela)
  if (!revealActive && pointInEnvelope(camera.position, -0.35) && !pointInEnvelope(_camPrev, -0.35)) {
    camera.position.copy(_camPrev);
    fixed = true;
  }
  if (!fixed) _camPrev.copy(camera.position);
}

function applyQualityDowngrade() {
  const q = Quality.get();
  document.body.dataset.quality = Quality.level;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  renderer.shadowMap.enabled = q.shadows;
  if (sunLight) sunLight.castShadow = q.shadows;
  if (DEBUG) console.info('Casa Aura: downgraded to', Quality.level);
}

// ============================================================
// GLOBAL ERROR HANDLING
// ============================================================
window.addEventListener('error', (e) => {
  if (DEBUG) console.error('Casa Aura error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  if (DEBUG) console.error('Casa Aura unhandled rejection:', e.reason);
});

// A auto-execucao saiu daqui. Quem decide QUANDO a cena sobe e a maquina
// de estados (LOADING -> HERO -> ...), em src/core/StateMachine.ts.
// Bindings VIVOS do ES module: `scene` e `camera` sao atribuidos dentro de
// init(), e quem importar daqui enxerga o valor atual, nao o de agora. E
// o que permite a UI se ligar na cena sem receber referencia por parametro.
export { init, showFallback, Experience, Quality, Perf, CONFIG, goToChapter,
         setLightMode, applySolarTime, toggleReveal,
         scene, camera, renderer, controls, composer, M, LP,
         solarTime, currentFPS, lampLights, houseGroup,
         waterObj, sunLight, currentLightMode };
export function _cenaPronta() { return !!(scene && renderer); }

// ------------------------------------------------------------
// PIPELINE DE TEXTURA, EXPOSTO PARA INSPEÇÃO
//
// Não é enfeite: é a correção de um problema de MÉTODO que custou duas
// regressões no núcleo em pedra. Para ver o efeito de mudar `courses` ou
// `jointWidth` eu estava rebuildando e rodando a cena inteira — ~10 min
// por tentativa nesta máquina, e o resultado chegava misturado com
// iluminação, névoa, tone mapping e a vegetação (que é aleatória a cada
// carregamento). Julgar uma textura assim é adivinhar.
//
// Estas quatro funções são PURAS e não dependem de cena, renderizador ou
// WebGL. Expostas, o mapa gerado pode ser desenhado num canvas e olhado
// a 1:1 em segundos. `src/legado/pedra-lab.ts` faz exatamente isso.
//
// Nada aqui é chamado em produção; o bundler remove por tree-shaking o
// que a aplicação não importa.
// ------------------------------------------------------------
export { heightField, cavityField, carveCourses, pbrFromHeight, grassTexture };
