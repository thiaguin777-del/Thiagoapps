// ============================================================
// Casa Aura Ultra — ponto de entrada
// ------------------------------------------------------------
// Só orquestra. Nada de lógica de cena aqui: a ordem é
//   estilo -> máquina de estados -> cena -> UI -> service worker
// e cada um desses vive no seu módulo.
// ============================================================
import './ui/estilo.css';
import { fsm } from './core/StateMachine';
import { registrarServiceWorker } from './core/ServiceWorker';

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

  registrarServiceWorker();
}

principal().catch((e) => {
  console.error('Casa Aura: erro não tratado no boot', e);
});
