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

async function principal(): Promise<void> {
  document.body.dataset.estado = fsm.atual();   // LOADING

  // A cena é carregada de forma assíncrona e SEPARADA do bundle inicial.
  // Regra de ouro nº 3: nada que não seja crítico para o primeiro quadro
  // entra no bundle de entrada. O three.js e a cena somam ~1 MB; o hero
  // aparece antes disso.
  const cena = await import('./legado/cena-bruta');

  try {
    await cena.init();
  } catch (e) {
    console.error('Casa Aura: falha fatal na inicialização', e);
    cena.showFallback('init-exception', e);
    return;
  }

  // A cena subiu: sai de LOADING. O hero já está no DOM desde o começo —
  // o fade só descobre o que já existe.
  await fsm.ir('HERO');

  // O painel comercial e o áudio são carregados sob demanda, nunca no
  // caminho do primeiro quadro.
  const { montarComercial } = await import('./ui/Commercial');
  montarComercial(fsm);

  const { HotspotManager } = await import('./ui/HotspotManager');
  HotspotManager.iniciar();
  HotspotManager.aoAbrir = (titulo) => analytics.registrar('hotspot', { titulo });

  // O auto-scaler so entra depois que a cena esta de pe: durante o boot
  // ainda ha compilacao de shader e upload de textura, e rebaixar por
  // causa disso puniria o aparelho errado.
  qualidade.ligar({
    renderer: cena.renderer,
    composer: cena.composer,
    aoModoLeve: (ligado) => {
      document.body.dataset.modoLeve = ligado ? '1' : '';
    },
  });

  // Pendura o auto-scaler no laco de render do legado.
  const w = window as unknown as { __auraPorQuadro?: (() => void)[] };
  w.__auraPorQuadro = w.__auraPorQuadro || [];
  w.__auraPorQuadro.push(() => qualidade.quadro());

  ligarBotoesDoHero(cena);
  registrarServiceWorker();
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
