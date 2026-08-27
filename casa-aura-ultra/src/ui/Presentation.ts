// ============================================================
// MODO APRESENTAÇÃO — o roteiro que roda sozinho
// ------------------------------------------------------------
// A diferença entre isto e o "Modo Cinemático" herdado importa, porque
// os dois parecem a mesma coisa e não são:
//
//   CINEMÁTICO   percorre os 13 capítulos, um teleporte por capítulo,
//                mostrando a casa inteira. É um índice animado.
//   APRESENTAÇÃO é um FILME. Oito planos escolhidos, com movimento de
//                câmera contínuo, foco puxado, legenda sincronizada e
//                um fim que leva ao comercial. É o que o corretor põe
//                para rodar enquanto fala.
//
// É aqui que o CameraDirector é usado de verdade — slerp de orientação,
// dolly zoom e rack focus não existem no voo herdado.
//
// SOBRE ASSUMIR OS BOTÕES DA UI HERDADA
// `#btn-present` já tem um listener do legado, que faz a versão antiga
// (goToChapter manual). Não dá para removê-lo: a referência da função
// não é exportada. A interceptação é feita na fase de CAPTURA no
// `document`, que roda ANTES de o evento chegar ao botão — parar a
// propagação ali garante que o handler antigo nunca dispara. É explícito
// e reversível, e é melhor que editar o legado, que continua sendo a
// versão que se sabe que funciona.
// ============================================================
import { diretor, type Plano } from '../core/CameraDirector';
import type { StateMachine } from '../core/StateMachine';
import roteiro from '../data/shots.json';

interface PlanoRoteiro extends Plano {
  titulo: string;
  legenda: string;
  luz?: string;
}

interface CenaMinima {
  setLightMode?: (m: string, dur?: number) => void;
  Experience?: { set?: (s: string) => void };
  controls?: { enabled: boolean };
}

/**
 * O import de JSON chega com `number[]`, não `[number, number, number]` —
 * o TypeScript não tem como saber o comprimento de um array literal em
 * JSON. Em vez de um `as unknown as` que apaga a checagem inteira, a
 * conversão é feita aqui, uma vez, VALIDANDO: um roteiro com um vetor de
 * dois elementos falha alto no boot em vez de mandar `undefined` para
 * dentro de um Vector3 e produzir uma câmera em NaN — que renderiza uma
 * tela preta sem nenhum erro.
 */
function trio(v: number[], onde: string): [number, number, number] {
  if (v.length !== 3 || v.some((n) => typeof n !== 'number' || !isFinite(n))) {
    throw new Error(`[apresentação] vetor inválido em ${onde}: ${JSON.stringify(v)}`);
  }
  return [v[0], v[1], v[2]];
}

const PLANOS: PlanoRoteiro[] = (roteiro.planos as Record<string, unknown>[]).map((p, i) => ({
  titulo: String(p.titulo ?? `Plano ${i + 1}`),
  legenda: String(p.legenda ?? ''),
  posicao: trio(p.posicao as number[], `plano ${i} .posicao`),
  alvo: trio(p.alvo as number[], `plano ${i} .alvo`),
  duracao: Number(p.duracao ?? 6),
  passagem: (p.passagem as number[][] | undefined)?.map((q, j) =>
    trio(q, `plano ${i} .passagem[${j}]`)),
  mirarSempre: p.mirarSempre === true,
  foco: p.foco === undefined ? undefined : Number(p.foco),
  fovFinal: p.fovFinal === undefined ? undefined : Number(p.fovFinal),
  pausa: p.pausa === undefined ? undefined : Number(p.pausa),
  luz: p.luz === undefined ? undefined : String(p.luz),
}));

class Apresentacao {
  private fsm: StateMachine | null = null;
  private cena: CenaMinima | null = null;
  private legendaEl: HTMLElement | null = null;
  private barraEl: HTMLElement | null = null;
  private rodando = false;
  private indice = 0;
  /** Onde a fatia atualmente tocando começa dentro de PLANOS. */
  private inicioDaFatia = 0;
  aoTerminar: (() => void) | null = null;

  montar(fsm: StateMachine, cena: CenaMinima): void {
    this.fsm = fsm;
    this.cena = cena;
    this.criarUI();

    document.addEventListener('click', this.interceptar, true);

    diretor.aoTrocarPlano = (i, p) => this.mostrarLegenda(i, p as PlanoRoteiro);
    diretor.aoTerminar = () => this.terminar();
  }

  /** Captura no document: chega antes do listener do legado no botão. */
  private interceptar = (e: MouseEvent): void => {
    const alvo = e.target as HTMLElement | null;
    if (!alvo) return;

    if (alvo.closest('#btn-present')) {
      e.stopPropagation();
      e.preventDefault();
      this.iniciar();
      return;
    }
    if (!this.rodando) return;

    // Enquanto a apresentação roda, sair e pular também são nossos.
    if (alvo.closest('#btn-exit-present')) {
      e.stopPropagation(); e.preventDefault(); this.terminar(); return;
    }
    if (alvo.closest('#btn-next')) {
      e.stopPropagation(); e.preventDefault(); this.pular(1); return;
    }
    if (alvo.closest('#btn-prev')) {
      e.stopPropagation(); e.preventDefault(); this.pular(-1); return;
    }
  };

  async iniciar(): Promise<void> {
    if (this.rodando || !this.fsm) return;
    // A FSM decide se a transição é legal. Se não for, não força.
    const ok = await this.fsm.ir('PRESENTATION', () => {
      document.getElementById('hero')?.classList.add('hidden');
      document.body.dataset.mode = 'present';
      // O legado tem o PROPRIO conceito de estado, e `clampFreeCamera()`
      // consulta ele: fora de 'cinematic'/'presenting' ela empurra a
      // camera para fora do envelope da casa a cada quadro. Sem esta
      // linha os dois planos INTERNOS do roteiro ("O estar" e "Cozinha e
      // jantar") eram revertidos assim que a camera entrava, e nunca
      // podiam ser alcancados.
      this.cena?.Experience?.set?.('presenting');
    });
    if (!ok) return;

    this.rodando = true;
    this.indice = 0;
    this.inicioDaFatia = 0;
    this.legendaEl?.classList.add('visivel');
    diretor.reproduzir(PLANOS);
  }

  private pular(d: number): void {
    const i = Math.max(0, Math.min(PLANOS.length - 1, this.indice + d));
    if (i === this.indice) return;
    // Reproduzir a partir de um índice: a fatia restante do roteiro. O
    // diretor sempre parte da posição ATUAL da câmera, então cortar a
    // lista já entrega o movimento certo.
    this.indice = i;
    this.inicioDaFatia = i;
    diretor.reproduzir(PLANOS.slice(i));
  }

  private mostrarLegenda(iRelativo: number, p: PlanoRoteiro): void {
    // `iRelativo` conta dentro da FATIA que está tocando; o índice real é
    // o começo da fatia mais ele. Guardar isso em `this.indice` não é
    // opcional: `pular()` parte de `this.indice`, e enquanto ele só era
    // escrito dentro do próprio `pular()`, assistir três planos e apertar
    // "próximo" voltava o filme para o plano 1 em vez de avançar.
    const real = Math.min(PLANOS.length - 1, this.inicioDaFatia + iRelativo);
    this.indice = real;
    if (!this.legendaEl) return;

    this.legendaEl.classList.remove('visivel');
    // Um quadro de espera antes de reanimar: sem isso o navegador não
    // reinicia a transição e a legenda troca sem fade.
    requestAnimationFrame(() => {
      if (!this.legendaEl) return;
      this.legendaEl.innerHTML =
        `<strong>${p.titulo}</strong><em>${p.legenda}</em>`;
      this.legendaEl.classList.add('visivel');
    });

    if (this.barraEl) {
      const pct = ((real + 1) / PLANOS.length) * 100;
      this.barraEl.style.width = pct.toFixed(1) + '%';
    }
    if (p.luz) this.cena?.setLightMode?.(p.luz);
  }

  private terminar(): void {
    if (!this.rodando) return;
    this.rodando = false;
    diretor.parar();
    this.legendaEl?.classList.remove('visivel');
    if (this.barraEl) this.barraEl.style.width = '0%';
    document.body.dataset.mode = 'explore';
    // O legado tem o próprio conceito de estado; mantê-lo em dia evita
    // que ele volte a esconder hotspots ou travar os controles.
    this.cena?.Experience?.set?.('explore');
    this.fsm?.ir('EXPLORING');
    this.aoTerminar?.();
  }

  private criarUI(): void {
    const l = document.createElement('div');
    l.id = 'legenda-apresentacao';
    document.body.appendChild(l);
    this.legendaEl = l;

    const trilho = document.createElement('div');
    trilho.id = 'progresso-apresentacao';
    const barra = document.createElement('i');
    trilho.appendChild(barra);
    document.body.appendChild(trilho);
    this.barraEl = barra;
  }

  get ativo(): boolean {
    return this.rodando;
  }

  get totalDePlanos(): number {
    return PLANOS.length;
  }

  destruir(): void {
    document.removeEventListener('click', this.interceptar, true);
    this.legendaEl?.remove();
    this.barraEl?.parentElement?.remove();
    this.legendaEl = this.barraEl = null;
  }
}

export const apresentacao = new Apresentacao();
