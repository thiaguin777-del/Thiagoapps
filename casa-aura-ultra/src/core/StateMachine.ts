// ============================================================
// MÁQUINA DE ESTADOS FINITA
// ------------------------------------------------------------
// Seis estados, transições explícitas, e um fade-to-black de 400 ms entre
// quaisquer dois — nunca corte seco.
//
// Por que uma FSM e não flags soltas: a versão anterior espalhava o estado
// em `body[data-mode]`, um `Experience.state`, o `revealActive`, o
// `presentPlaying` e mais três booleanos. Combinações impossíveis eram
// alcançáveis (apresentação rodando com o Modo Corte aberto e o hero
// visível), e cada uma virava um bug de UI que só aparecia numa ordem
// específica de cliques.
//
// Aqui a transição é a ÚNICA forma de mudar de estado, e ela é validada
// contra uma tabela. O que não está na tabela não acontece.
// ============================================================

export type Estado =
  | 'LOADING'
  | 'HERO'
  | 'EXPLORING'
  | 'CINEMATIC'
  | 'PRESENTATION'
  | 'COMMERCIAL';

type Ouvinte = (para: Estado, de: Estado) => void;

// Transições permitidas. Ler como "de -> para onde pode ir".
//
// COMMERCIAL volta para EXPLORING de propósito: o painel comercial é um
// destino, não um beco. O construtor que abriu o preço tem de conseguir
// voltar para a casa sem recarregar.
const PERMITIDO: Record<Estado, Estado[]> = {
  LOADING: ['HERO', 'COMMERCIAL'],
  HERO: ['EXPLORING', 'CINEMATIC', 'COMMERCIAL'],
  EXPLORING: ['CINEMATIC', 'PRESENTATION', 'COMMERCIAL', 'HERO'],
  CINEMATIC: ['EXPLORING', 'COMMERCIAL'],
  PRESENTATION: ['EXPLORING', 'COMMERCIAL'],
  COMMERCIAL: ['EXPLORING', 'HERO'],
};

const DURACAO_FADE = 400;

export class StateMachine {
  private estado: Estado = 'LOADING';
  private ouvintes: Ouvinte[] = [];
  private emTransicao = false;
  private veu: HTMLDivElement;
  /** Marca de tempo de entrada em cada estado, para a telemetria por capítulo. */
  private entrouEm = performance.now();
  public tempoPorEstado: Partial<Record<Estado, number>> = {};

  constructor() {
    this.veu = document.createElement('div');
    this.veu.id = 'fsm-veu';
    // `pointer-events: none` importa: durante o fade o clique tem de
    // continuar chegando na UI de baixo, senão o usuário sente travamento.
    this.veu.style.cssText = [
      'position:fixed', 'inset:0', 'background:#000', 'opacity:0',
      'pointer-events:none', 'z-index:9998',
      `transition:opacity ${DURACAO_FADE / 2}ms ease`,
    ].join(';');
    document.body.appendChild(this.veu);
  }

  atual(): Estado {
    return this.estado;
  }

  aoMudar(fn: Ouvinte): () => void {
    this.ouvintes.push(fn);
    return () => {
      const i = this.ouvintes.indexOf(fn);
      if (i >= 0) this.ouvintes.splice(i, 1);
    };
  }

  podeIr(para: Estado): boolean {
    return PERMITIDO[this.estado].includes(para);
  }

  /**
   * Troca de estado com fade-to-black. O trabalho pesado (`durante`) roda
   * com a tela PRETA, que é o ponto de fazer o fade: um rebuild de cena ou
   * um teleporte de câmera fica invisível.
   */
  async ir(para: Estado, durante?: () => void | Promise<void>): Promise<boolean> {
    if (this.emTransicao) return false;
    if (para === this.estado) return false;
    if (!this.podeIr(para)) {
      console.warn(`[fsm] transição recusada: ${this.estado} -> ${para}`);
      return false;
    }
    this.emTransicao = true;
    const de = this.estado;

    // contabiliza o tempo no estado que está saindo, para a telemetria
    const agora = performance.now();
    this.tempoPorEstado[de] = (this.tempoPorEstado[de] || 0) + (agora - this.entrouEm);

    await this.fade(1);
    try {
      if (durante) await durante();
    } catch (e) {
      console.error('[fsm] erro durante a transição:', e);
    }
    this.estado = para;
    this.entrouEm = performance.now();
    document.body.dataset.estado = para;
    this.ouvintes.forEach((fn) => {
      try { fn(para, de); } catch (e) { console.error('[fsm] ouvinte falhou:', e); }
    });
    await this.fade(0);
    this.emTransicao = false;
    return true;
  }

  private fade(alvo: number): Promise<void> {
    return new Promise((resolve) => {
      this.veu.style.opacity = String(alvo);
      window.setTimeout(resolve, DURACAO_FADE / 2);
    });
  }

  /** Fecha a contagem do estado corrente. Usado antes de enviar telemetria. */
  fecharContagem(): void {
    const agora = performance.now();
    this.tempoPorEstado[this.estado] =
      (this.tempoPorEstado[this.estado] || 0) + (agora - this.entrouEm);
    this.entrouEm = agora;
  }
}

export const fsm = new StateMachine();
