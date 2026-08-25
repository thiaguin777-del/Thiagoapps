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
      M: cena.M, Quality: cena.Quality,
      sunLight: cena.sunLight, solarTime: cena.solarTime,
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
  registrarServiceWorker();
  marco('pronto');
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
