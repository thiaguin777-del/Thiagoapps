// ============================================================
// Casa Aura Ultra — ponto de entrada
// ------------------------------------------------------------
// Só orquestra. Nada de lógica de cena aqui: a ordem é
//   estilo -> máquina de estados -> cena -> UI -> service worker
// e cada um desses vive no seu módulo.
// ============================================================
import './ui/estilo.css';
import './ui/ultra.css';
import { fsm } from './core/StateMachine';
import { registrarServiceWorker } from './core/ServiceWorker';
import { qualidade } from './core/QualityController';
import { analytics } from './core/Analytics';

/**
 * Marcos do boot. Não é depuração descartável: o ambiente de
 * desenvolvimento não tem GPU, então quando algo trava no aparelho do
 * cliente esta lista é a única forma de saber ONDE travou. Fica.
 */
const marcos: { etapa: string; ms: number }[] = [];
function marco(etapa: string): void {
  marcos.push({ etapa, ms: Math.round(performance.now()) });
  (window as unknown as { __auraMarcos?: unknown }).__auraMarcos = marcos;
}

/**
 * Vigia o fallback do legado. `init()` NÃO lança na maioria das falhas —
 * ela chama `showFallback` internamente e retorna normalmente (sem
 * contexto WebGL, falha ao construir a cena, e o timeout de 20 s que
 * dispara muito depois de `init()` ter voltado). Um try/catch em volta do
 * `init()` pega só o caso mais raro.
 *
 * Então o gatilho é o efeito observável comum a TODOS os caminhos: a
 * classe `.show` aparecendo em `#fallback`. Assim o fallback rico entra
 * inclusive quando a falha acontece minutos depois do boot.
 */
function vigiarFallback(): void {
  const el = document.getElementById('fallback');
  if (!el) return;
  const entrar = async () => {
    const { montarFallback } = await import('./ui/Fallback');
    montarFallback('fallback do legado ativado');
  };
  if (el.classList.contains('show')) { void entrar(); return; }
  const obs = new MutationObserver(() => {
    if (el.classList.contains('show')) { obs.disconnect(); void entrar(); }
  });
  obs.observe(el, { attributes: true, attributeFilter: ['class'] });
}

async function principal(): Promise<void> {
  document.body.dataset.estado = fsm.atual();   // LOADING
  marco('inicio');
  vigiarFallback();

  // A cena é carregada de forma assíncrona e SEPARADA do bundle inicial.
  // Regra de ouro nº 3: nada que não seja crítico para o primeiro quadro
  // entra no bundle de entrada. O three.js e a cena somam ~1 MB; o hero
  // aparece antes disso.
  const cena = await import('./legado/cena-bruta');
  marco('modulo-da-cena');

  try {
    await cena.init();
    marco('init');
  } catch (e) {
    console.error('Casa Aura: falha fatal na inicialização', e);
    // O fallback do legado é uma mensagem de desculpas. O rico entra por
    // cima com planta, ficha e contato — conteúdo que ainda vende a casa
    // num aparelho que não roda WebGL.
    // O observador acima monta o fallback rico quando esta chamada marcar
    // `#fallback` com `.show`.
    cena.showFallback('init-exception', e);
    return;
  }

  // `init()` pode ter caído no fallback sem lançar. Se a cena não subiu,
  // não há o que decorar com cáusticas e feixes.
  if (!cena._cenaPronta()) {
    console.warn('Casa Aura: cena não subiu, seguindo só com o fallback');
    return;
  }

  // ------------------------------------------------------------
  // UPGRADES DA CENA
  // Cáusticas, feixes volumétricos, partículas, DOF, anti-aliasing e o
  // diretor de câmera entram AQUI, depois do init: antes dele os
  // materiais e o composer ainda não existem. É também por isso que o
  // módulo é importado de forma estática mas só executa agora — ele não
  // toca em nada no momento do import.
  // ------------------------------------------------------------
  const { cenaAura } = await import('./scenes/CasaAuraScene');
  marco('modulo-de-upgrades');
  try {
    cenaAura.montar({
      scene: cena.scene, camera: cena.camera, renderer: cena.renderer,
      controls: cena.controls, composer: cena.composer,
      M: cena.M, Quality: cena.Quality, houseGroup: cena.houseGroup,
      lampLights: cena.lampLights,
      sunLight: cena.sunLight, solarTime: cena.solarTime,
      transitionNeedsCut: cena.transitionNeedsCut,
      doFadeCut: cena.doFadeCut,
      pointInEnvelope: cena.pointInEnvelope,
    });
  } catch (e) {
    // Um efeito que falha não pode derrubar a visita. A casa vale mais
    // que as cáusticas.
    console.error('Casa Aura: upgrades de cena falharam, seguindo sem eles', e);
  }

  // Expõe a cena para inspeção. Não é enfeite: o ambiente de
  // desenvolvimento não tem GPU, então quem mede de verdade é o Thiago no
  // iPad e no celular, e para isso ele precisa de um ponto de entrada.
  (window as unknown as { __auraCena?: unknown }).__auraCena = cena;

  const w2 = window as unknown as { __auraAntesDoQuadro?: ((dt: number) => void)[] };
  w2.__auraAntesDoQuadro = w2.__auraAntesDoQuadro || [];
  w2.__auraAntesDoQuadro.push((dt) => cenaAura.quadro(dt, cena.solarTime));

  fsm.aoMudar((estado) => cenaAura.aoMudarEstado(estado));
  window.addEventListener('resize', () => {
    cenaAura.redimensionar(window.innerWidth, window.innerHeight);
  });

  // ------------------------------------------------------------
  // PRÉ-COMPILAÇÃO DE SHADER — contra o engasgo, não contra o FPS médio
  //
  // No Three.js o programa de um material só é compilado quando aquele
  // material aparece pela PRIMEIRA vez num quadro. O projeto não tinha
  // nenhuma pré-compilação: cada material novo que entrava em quadro
  // parava a thread principal enquanto o driver compilava, e isso
  // acontece exatamente quando a câmera começa a girar — ou seja, no
  // primeiro movimento do Modo Apresentação, com o corretor olhando.
  //
  // Isso não aparece em média de FPS nenhuma. Aparece como travadinha, e
  // travadinha é o defeito que o cliente relatou.
  //
  // `compileAsync` usa KHR_parallel_shader_compile quando o driver tem, e
  // cai para compilação síncrona quando não tem — nos dois casos aqui, na
  // tela de carregamento, que é onde uma espera é esperada.
  //
  // Com corrida contra um teto de tempo: num aparelho fraco a compilação
  // inteira pode passar de dez segundos, e travar o carregamento seria
  // trocar um defeito por outro pior. O que não compilar aqui compila
  // no caminho, como antes — nunca fica pior que o estado anterior.
  // ------------------------------------------------------------
  try {
    const r = cena.renderer as {
      info: { programs?: unknown[] };
      compile: (s: unknown, c: unknown) => void;
      compileAsync?: (s: unknown, c: unknown) => Promise<unknown>;
    };
    const antes = r.info.programs?.length ?? 0;
    const t0 = performance.now();
    if (typeof r.compileAsync === 'function') {
      await Promise.race([
        r.compileAsync(cena.scene, cena.camera),
        new Promise((res) => setTimeout(res, 9000)),
      ]);
    } else {
      r.compile(cena.scene, cena.camera);
    }
    const depois = r.info.programs?.length ?? 0;
    console.info(`[preaquecimento] ${antes} -> ${depois} programas em `
      + `${(performance.now() - t0).toFixed(0)} ms`);
    (window as unknown as { __auraPreaquecimento?: unknown }).__auraPreaquecimento =
      { antes, depois, ms: +(performance.now() - t0).toFixed(1) };
  } catch (e) {
    console.warn('Casa Aura: pré-compilação falhou, seguindo sem ela', e);
  }

  // A cena subiu: sai de LOADING. O hero já está no DOM desde o começo —
  // o fade só descobre o que já existe.
  marco('upgrades');
  await fsm.ir('HERO');
  marco('hero');

  // A entrada do texto só começa depois do fade: animar por baixo do véu
  // preto é gastar a animação onde ninguém a vê.
  const { animarHero, ligarBotoesMagneticos } = await import('./ui/Hero');
  animarHero();
  ligarBotoesMagneticos();

  // O painel comercial e o áudio são carregados sob demanda, nunca no
  // caminho do primeiro quadro.
  const { montarComercial } = await import('./ui/Commercial');
  montarComercial(fsm);

  // A apresentação assume o botão herdado e roda o roteiro pelo diretor
  // de câmera. Ao terminar, cai no painel comercial — que é o ponto do
  // filme: a última coisa que o cliente vê é o convite.
  const { apresentacao } = await import('./ui/Presentation');
  apresentacao.montar(fsm, cena);

  // ------------------------------------------------------------
  // VALIDAÇÃO GEOMÉTRICA DO ROTEIRO — `?validar=1`
  //
  // O cliente relatou que a apresentação podia mostrar paisagem em vez
  // da casa. As causas mecânicas foram corrigidas no CameraDirector, mas
  // "corrigi a mecânica" não é o mesmo que "os oito enquadramentos estão
  // certos". Isto mede, lançando raios contra a geometria que está na
  // cena: quanto do quadro é casa, se o centro do quadro encontra a
  // casa, se a câmera está dentro de algum sólido, e se partida e
  // chegada estão do mesmo lado da fachada.
  //
  // Fora da flag o módulo nem é baixado: `import()` dinâmico dentro do
  // `if`. Custo zero em produção.
  // ------------------------------------------------------------
  if (new URLSearchParams(location.search).get('validar') === '1') {
    try {
      const { validarPlanos } = await import('./core/ValidadorDePlanos');
      const casa = cena.houseGroup ?? cena.scene;
      const laudos = validarPlanos(
        apresentacao.roteiro, casa, cena.camera, cena.pointInEnvelope!,
      );
      (window as unknown as { __auraValidacao?: unknown }).__auraValidacao = laudos;
      const ruins = laudos.filter((l) => l.problemas.length > 0);
      console.info(`[validador] ${laudos.length} planos, ${ruins.length} com problema`);
      for (const l of ruins) console.warn(`[validador] ${l.indice} ${l.titulo}:`, l.problemas);
    } catch (e) {
      console.error('[validador] falhou', e);
    }
  }

  // `await` + try/catch, e não `iniciar()` solto, por dois motivos:
  //
  // 1. Disparar uma função async sem await transforma qualquer exceção
  //    dentro dela numa rejeição não tratada — sem linha vermelha no
  //    console e sem interromper nada.
  // 2. Sem o await, `pronto` era marcado ANTES de os marcadores
  //    existirem. Não quebrava o produto, mas mentia para a telemetria e
  //    para qualquer verificação automatizada, que via zero hotspots numa
  //    experiência que estava correta. Marco de "pronto" tem de
  //    significar pronto.
  // O painel do Modo Seção assume o botão herdado `#btn-reveal`.
  const { hud } = await import('./ui/HUD');
  hud.montar();
  hud.aoAlternar = (ativo, eixo) => analytics.registrar('corte', { ativo, eixo });

  const { HotspotManager } = await import('./ui/HotspotManager');
  try {
    await HotspotManager.iniciar();
    HotspotManager.aoAbrir = (titulo) => analytics.registrar('hotspot', { titulo });
  } catch (e) {
    console.error('Casa Aura: hotspots falharam', e);
  }

  // O auto-scaler so entra depois que a cena esta de pe: durante o boot
  // ainda ha compilacao de shader e upload de textura, e rebaixar por
  // causa disso puniria o aparelho errado.
  qualidade.ligar({
    renderer: cena.renderer,
    composer: cena.composer,
    aoModoLeve: (ligado) => {
      document.body.dataset.modoLeve = ligado ? '1' : '';
      // Partículas e feixes volumétricos saem junto. Sem esta linha o
      // Modo Leve prometia mais do que entregava.
      cenaAura.modoLeve(ligado);
    },
  });

  // Pendura o auto-scaler no laco de render do legado.
  const w = window as unknown as { __auraPorQuadro?: (() => void)[] };
  w.__auraPorQuadro = w.__auraPorQuadro || [];
  w.__auraPorQuadro.push(() => qualidade.quadro());

  ligarBotoesDoHero(cena);
  await ligarAudio(cena);
  registrarServiceWorker();
  marco('pronto');
}

/**
 * O botão de som vinha com `display:none` no HTML porque o áudio nunca
 * existiu — os MP3 do manifesto não estão no repositório. Agora o
 * ambiente é sintetizado em tempo de execução, então o botão aparece.
 *
 * O módulo de áudio só é BAIXADO quando o usuário clica: o Howler são
 * ~30 KB que ninguém precisa carregar para ver a casa em silêncio.
 */
async function ligarAudio(cena: {
  camera?: { position: { x: number; y: number; z: number }; getWorldDirection: (v: unknown) => void };
}): Promise<void> {
  const btn = document.getElementById('btn-audio');
  if (!btn) return;
  btn.style.display = '';
  btn.textContent = 'Som';

  let audioMod: typeof import('./core/AudioManager') | null = null;

  btn.addEventListener('click', async () => {
    if (!audioMod) {
      btn.textContent = '…';
      audioMod = await import('./core/AudioManager');
    }
    const ligado = audioMod.audio.alternar();
    btn.textContent = ligado ? 'Som ligado' : 'Som';
    btn.classList.toggle('active', ligado);
    analytics.registrar('audio', { ligado });

    if (!ligado) return;
    // O ouvinte só passa a ser atualizado quando há som para ouvir.
    const cam = cena.camera;
    if (!cam) return;
    const w = window as unknown as { __auraAntesDoQuadro?: ((dt: number) => void)[] };
    if ((w as { __auraOuvinte?: boolean }).__auraOuvinte) return;
    (w as { __auraOuvinte?: boolean }).__auraOuvinte = true;
    // Vector3 DE VERDADE, e não `{x,y,z}`: `getWorldDirection` chama
    // `target.set(...)` no que recebe. Com um objeto simples isso lança
    // TypeError dentro do gancho por quadro, o `WebGLAnimation` do three
    // nunca volta a pedir o quadro seguinte, e a cena CONGELA PARA
    // SEMPRE — na primeira vez que o cliente liga o som. Era o defeito
    // mais grave do projeto e estava escondido atrás de um botão.
    const { Vector3 } = await import('three');
    const frente = new Vector3(0, 0, -1);
    w.__auraAntesDoQuadro?.push(() => {
      // O gancho roda dentro do laço de render do legado, que não tem
      // try/catch: qualquer exceção aqui mata a animação inteira.
      try {
        cam.getWorldDirection(frente);
        audioMod?.audio.atualizarOuvinte(
          cam.position.x, cam.position.y, cam.position.z,
          frente.x, frente.y, frente.z,
        );
      } catch (e) {
        console.error('[audio] ouvinte falhou, seguindo sem espacializacao', e);
      }
    });
  });
}

/**
 * Os botoes do hero passam a falar com a FSM em vez de mexer no DOM
 * diretamente. E o que garante que "Explorar" e "Modo Cinematico" nunca
 * deixem a experiencia num estado hibrido.
 */
function ligarBotoesDoHero(cena: { Experience?: { set?: (s: string) => void } }): void {
  const hero = document.getElementById('hero');
  const esconderHero = () => {
    hero?.classList.add('hidden');
    hero?.classList.remove('visible');
  };

  document.getElementById('btn-explore')?.addEventListener('click', () => {
    analytics.registrar('modo', { modo: 'explorar' });
    fsm.ir('EXPLORING', esconderHero);
  });

  document.getElementById('btn-cinematic')?.addEventListener('click', () => {
    analytics.registrar('modo', { modo: 'cinematico' });
    fsm.ir('CINEMATIC', () => {
      esconderHero();
      cena.Experience?.set?.('cinematic');
    });
  });
}

principal().catch((e) => {
  console.error('Casa Aura: erro não tratado no boot', e);
});
