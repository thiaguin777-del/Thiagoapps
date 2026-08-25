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

async function principal(): Promise<void> {
  document.body.dataset.estado = fsm.atual();   // LOADING
  marco('inicio');

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
    cena.showFallback('init-exception', e);
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

  // O painel comercial e o áudio são carregados sob demanda, nunca no
  // caminho do primeiro quadro.
  const { montarComercial } = await import('./ui/Commercial');
  montarComercial(fsm);

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
