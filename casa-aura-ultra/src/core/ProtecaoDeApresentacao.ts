// ============================================================
// PROTEÇÃO DE APRESENTAÇÃO — três tiers, e o terceiro não é 3D
// ------------------------------------------------------------
// O `QualityController` degrada a cena por degraus. Isso resolve o
// aparelho que está *quase* dando conta. Não resolve o aparelho que não
// vai dar conta de jeito nenhum — e ali o resultado de insistir é uma
// apresentação travada na frente de um cliente, que é o pior desfecho
// possível deste produto.
//
// Três tiers, e a diferença entre eles é de NATUREZA, não de grau:
//
//   REALTIME           tudo ligado. Só para hardware que se identificou
//                      e provou desempenho depois do aquecimento.
//   COMPATIBILITY      o padrão para hardware DESCONHECIDO. DPR baixo,
//                      sem sombra, sem pós-processamento caro, sem
//                      partícula, sem volumetria, sem transmissão. Ainda
//                      é a casa, ainda é 3D, ainda navega.
//   PRESENTATION_SAFE  desiste do 3D. O canvas sai da composição e a
//                      jornada comercial continua por renders reais da
//                      própria cena. Não é uma tela de desculpas: é a
//                      mesma apresentação, por outro meio.
//
// COMEÇAR EM COMPATIBILITY é a decisão que carrega o resto. Subir de
// tier depois de medir é seguro; descer depois de o cliente já ter visto
// engasgo não desfaz o que ele viu.
//
// NENHUMA MÉTRICA AQUI É PROMESSA. Este arquivo mede o que está
// acontecendo no aparelho de quem abriu. O que ele NÃO faz é garantir
// número nenhum — ver MATRIZ_DISPOSITIVOS.md.
// ============================================================

export type Tier = 'REALTIME' | 'COMPATIBILITY' | 'PRESENTATION_SAFE';

/** Tudo que o governador precisa poder desligar. */
export interface Aplicador {
  /** Pixel ratio efetivo do renderizador. */
  pixelRatio(v: number): void;
  /** Sombras do rig principal. */
  sombras(ligado: boolean): void;
  /** Passes caros do composer: GTAO, bloom, DOF. */
  posProcessamento(ligado: boolean): void;
  /** Anti-aliasing por amostras nos alvos do composer. */
  antialias(ligado: boolean): void;
  /** Partículas, volumetria e animação de água. */
  decoracao(ligado: boolean): void;
  /** Materiais com transmissão (vidro caro) viram opacos aproximados. */
  transmissao(ligado: boolean): void;
  /** Tone mapping simples em vez de ACES no passe de grade. */
  toneMappingSimples(ligado: boolean): void;
  /** Estatísticas do último quadro. */
  estatisticas(): { draws: number; triangulos: number; programas: number };
  /** Liga ou desliga o desenho da cena 3D. */
  renderizar(ligado: boolean): void;
}

interface Sonda {
  webgl2: boolean;
  renderer: string | null;
  vendor: string | null;
  memoriaGB: number | null;
  nucleos: number | null;
  dpr: number;
  viewport: [number, number];
  maxTextura: number | null;
  /** Aparelho reconhecido como capaz o bastante para começar em REALTIME. */
  conhecidoBom: boolean;
  motivo: string;
}

// ------------------------------------------------------------
// LIMIARES
//
// Vêm da diretriz de fechamento e são deliberadamente citados aqui em
// vez de espalhados: mudar um número de desempenho tem de ser uma
// decisão consciente, num lugar só.
// ------------------------------------------------------------
const JANELA_MS = 2000;          // janela de avaliação
const FPS_DEGRAU = 24;           // mediana abaixo disto: degradar
const P95_DEGRAU_MS = 55;        // p95 do tempo de quadro acima disto: degradar
const FPS_SEGURO = 15;           // abaixo disto, por tempo suficiente: modo seguro
const MS_ATE_SEGURO = 4000;      // tempo abaixo de FPS_SEGURO que dispara
const AQUECIMENTO_MS = 1500;     // quadros iniciais ignorados (compilação/upload)
const ANEL = 600;

/**
 * GPUs cujo nome basta para liberar REALTIME de saída. A lista é curta e
 * conservadora de propósito: errar para o lado de COMPATIBILITY custa
 * um pouco de brilho; errar para o lado de REALTIME custa a apresentação.
 */
const RENDERER_BOM = /(RTX|GTX 1[0-9]{3}|RX [5-7][0-9]{3}|Apple M[1-9]|Radeon Pro|Quadro|Arc A[0-9])/i;
/** GPUs e renderizadores que já indicam modo seguro sem medir. */
const RENDERER_RUIM = /(SwiftShader|llvmpipe|Software|Microsoft Basic|Mesa OffScreen)/i;

export class ProtecaoDeApresentacao {
  private ap: Aplicador | null = null;
  private _tier: Tier = 'COMPATIBILITY';
  private _sonda: Sonda | null = null;
  private _motivoDaTroca = 'início: hardware não identificado';

  private anel = new Float32Array(ANEL);
  private n = 0;
  private tUltimo = 0;
  private tJanela = 0;
  private tAbaixoDoSeguro = 0;
  private tInicio = 0;
  private degrau = 0;                  // 0..3 dentro de COMPATIBILITY
  private aquecido = false;

  /** Toda transição carrega ficha; uma nova invalida as pendentes. */
  private ficha = 0;
  private pendentes = new Set<number>();

  aoTrocarTier: ((tier: Tier, motivo: string) => void) | null = null;

  get tier(): Tier { return this._tier; }
  get sonda(): Sonda | null { return this._sonda; }
  get motivoDaTroca(): string { return this._motivoDaTroca; }

  // ------------------------------------------------------------
  /**
   * Lê o que dá para saber ANTES de desenhar qualquer coisa.
   *
   * `WEBGL_debug_renderer_info` é a única forma de saber a GPU, e
   * navegadores com privacidade reforçada a escondem — por isso o
   * resultado é sempre tratado como *pista*, nunca como verdade. Quando
   * não há pista, a resposta é COMPATIBILITY, não um chute otimista.
   */
  sondar(gl: WebGLRenderingContext | WebGL2RenderingContext | null): Sonda {
    let renderer: string | null = null;
    let vendor: string | null = null;
    let maxTextura: number | null = null;
    let webgl2 = false;
    try {
      if (gl) {
        webgl2 = typeof WebGL2RenderingContext !== 'undefined'
          && gl instanceof WebGL2RenderingContext;
        maxTextura = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') || null;
          vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? '') || null;
        }
      }
    } catch { /* extensão ausente ou bloqueada: segue sem pista */ }

    const nav = navigator as Navigator & { deviceMemory?: number };
    const memoriaGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
    const nucleos = navigator.hardwareConcurrency || null;
    const dpr = window.devicePixelRatio || 1;
    const viewport: [number, number] = [window.innerWidth, window.innerHeight];

    let conhecidoBom = false;
    let motivo: string;
    if (!gl) {
      motivo = 'sem contexto WebGL';
    } else if (renderer && RENDERER_RUIM.test(renderer)) {
      motivo = `renderizador por software detectado (${renderer})`;
    } else if (renderer && RENDERER_BOM.test(renderer)) {
      conhecidoBom = true;
      motivo = `GPU reconhecida (${renderer})`;
    } else if (!renderer) {
      motivo = 'GPU não identificável (WEBGL_debug_renderer_info indisponível)';
    } else if (memoriaGB !== null && memoriaGB <= 2) {
      motivo = `memória do aparelho baixa (${memoriaGB} GB)`;
    } else {
      motivo = `GPU não catalogada (${renderer})`;
    }

    this._sonda = { webgl2, renderer, vendor, memoriaGB, nucleos, dpr,
                    viewport, maxTextura, conhecidoBom, motivo };
    return this._sonda;
  }

  // ------------------------------------------------------------
  ligar(ap: Aplicador, forcado?: Tier): void {
    this.ap = ap;
    this.tInicio = performance.now();
    this.tJanela = this.tInicio;
    this.tUltimo = this.tInicio;

    if (forcado) {
      this.trocar(forcado, 'forçado por ?tier=');
      return;
    }
    const s = this._sonda;
    if (s && !s.webgl2 && !s.renderer) {
      this.trocar('PRESENTATION_SAFE', s.motivo);
      return;
    }
    if (s && s.renderer && RENDERER_RUIM.test(s.renderer)) {
      this.trocar('PRESENTATION_SAFE', s.motivo);
      return;
    }
    // Hardware conhecidamente bom entra em REALTIME; todo o resto começa
    // em COMPATIBILITY e SOBE se provar. Ver o cabeçalho.
    this.trocar(s && s.conhecidoBom ? 'REALTIME' : 'COMPATIBILITY',
                s ? s.motivo : 'sem sonda');
  }

  // ------------------------------------------------------------
  /** Uma chamada por quadro, do laço de render. */
  quadro(): void {
    const agora = performance.now();
    const ms = agora - this.tUltimo;
    this.tUltimo = agora;
    if (this._tier === 'PRESENTATION_SAFE') return;

    // Aquecimento: compilação de shader e upload de textura acontecem
    // aqui, e medir isso é medir o boot, não a navegação.
    if (!this.aquecido) {
      if (agora - this.tInicio < AQUECIMENTO_MS) return;
      this.aquecido = true;
      this.tJanela = agora;
      this.n = 0;
      return;
    }

    this.anel[this.n % ANEL] = ms;
    this.n++;

    if (agora - this.tJanela < JANELA_MS) return;
    const janela = agora - this.tJanela;
    this.tJanela = agora;
    const pc = this.percentis();
    if (!pc) return;
    const fpsMediana = 1000 / pc.p50;

    // Caminho do modo seguro: FPS abaixo do piso por tempo suficiente.
    if (fpsMediana < FPS_SEGURO) {
      this.tAbaixoDoSeguro += janela;
      if (this.tAbaixoDoSeguro >= MS_ATE_SEGURO) {
        this.trocar('PRESENTATION_SAFE',
          `${fpsMediana.toFixed(1)} fps de mediana por ${(this.tAbaixoDoSeguro / 1000).toFixed(1)} s`);
        return;
      }
    } else {
      this.tAbaixoDoSeguro = 0;
    }

    const ruim = fpsMediana < FPS_DEGRAU || pc.p95 > P95_DEGRAU_MS;
    if (ruim) {
      this.degradar(`mediana ${fpsMediana.toFixed(1)} fps, p95 ${pc.p95.toFixed(1)} ms`);
    }
  }

  // ------------------------------------------------------------
  private degradar(motivo: string): void {
    if (this._tier === 'REALTIME') {
      this.trocar('COMPATIBILITY', motivo);
      return;
    }
    if (this.degrau >= 3) {
      // Já no fundo do COMPATIBILITY e ainda ruim. Não há degrau que
      // salve; o próximo passo é sair do 3D.
      this.trocar('PRESENTATION_SAFE', `no degrau mínimo e ainda ${motivo}`);
      return;
    }
    this.degrau++;
    this._motivoDaTroca = `degrau ${this.degrau}: ${motivo}`;
    this.aplicarDegrau();
    console.info(`[protecao] ${this._motivoDaTroca}`);
  }

  private aplicarDegrau(): void {
    const a = this.ap;
    if (!a) return;
    // Ordem de corte por custo, do mais caro por pixel ao mais barato.
    const dpr = [0.6, 0.5, 0.45, 0.4][this.degrau] ?? 0.4;
    a.pixelRatio(dpr);
    if (this.degrau >= 1) a.posProcessamento(false);
    if (this.degrau >= 2) a.antialias(false);
    if (this.degrau >= 3) a.decoracao(false);
  }

  // ------------------------------------------------------------
  /**
   * Troca de tier com ficha de cancelamento.
   *
   * A diretriz é explícita: nenhuma transição sem token e sem limpeza.
   * Uma troca invalida as pendentes — se o aparelho desabar durante a
   * subida para REALTIME, o callback da subida não pode aplicar depois
   * de o modo seguro já ter assumido.
   */
  private trocar(tier: Tier, motivo: string): void {
    if (tier === this._tier && this.ficha !== 0) return;
    const minha = ++this.ficha;
    this.pendentes.clear();
    this.pendentes.add(minha);

    this._tier = tier;
    this._motivoDaTroca = motivo;
    this.aquecido = tier === 'REALTIME' ? this.aquecido : this.aquecido;
    this.tAbaixoDoSeguro = 0;

    const a = this.ap;
    if (a) {
      if (tier === 'REALTIME') {
        this.degrau = 0;
        a.renderizar(true);
        a.pixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        a.sombras(true); a.posProcessamento(true); a.antialias(true);
        a.decoracao(true); a.transmissao(true); a.toneMappingSimples(false);
      } else if (tier === 'COMPATIBILITY') {
        this.degrau = 0;
        a.renderizar(true);
        a.pixelRatio(0.6);
        a.sombras(false); a.posProcessamento(false); a.antialias(false);
        a.decoracao(false); a.transmissao(false); a.toneMappingSimples(true);
      } else {
        a.renderizar(false);
      }
    }
    if (!this.pendentes.has(minha)) return;   // outra troca venceu
    document.body.dataset.tier = tier;
    console.info(`[protecao] tier = ${tier} — ${motivo}`);
    this.aoTrocarTier?.(tier, motivo);
  }

  /** Força um tier de fora (auditoria, `?tier=`). */
  forcar(tier: Tier, motivo = 'forçado'): void {
    this.trocar(tier, motivo);
  }

  // ------------------------------------------------------------
  percentis(): { p50: number; p95: number; p99: number; pior: number; n: number } | null {
    const n = Math.min(this.n, ANEL);
    if (n < 12) return null;
    const v = Array.prototype.slice.call(this.anel, 0, n).sort((x: number, y: number) => x - y);
    const q = (f: number) => +v[Math.min(n - 1, Math.floor(f * n))].toFixed(2);
    return { p50: q(0.5), p95: q(0.95), p99: q(0.99), pior: +v[n - 1].toFixed(2), n };
  }

  /**
   * O relatório que a diretriz pede. Tudo que ele afirma foi medido
   * NESTE aparelho, nesta sessão — nada aqui é promessa de desempenho.
   */
  relatorio(): Record<string, unknown> {
    const pc = this.percentis();
    const est = this.ap?.estatisticas();
    const s = this._sonda;
    return {
      tier: this._tier,
      motivoDaTroca: this._motivoDaTroca,
      degrau: this.degrau,
      fps: pc ? { p50: +(1000 / pc.p50).toFixed(1), p95: +(1000 / pc.p95).toFixed(1),
                  p99: +(1000 / pc.p99).toFixed(1) } : 'UNMEASURED',
      quadroMs: pc ? { p50: pc.p50, p95: pc.p95, p99: pc.p99, pior: pc.pior, amostras: pc.n }
                   : 'UNMEASURED',
      draws: est ? est.draws : null,
      triangulos: est ? est.triangulos : null,
      programas: est ? est.programas : null,
      dpr: s ? s.dpr : null,
      renderer: s ? s.renderer : null,
      vendor: s ? s.vendor : null,
      webgl2: s ? s.webgl2 : null,
      memoriaGB: s ? s.memoriaGB : null,
      nucleos: s ? s.nucleos : null,
      viewport: s ? s.viewport : null,
    };
  }
}

export const protecao = new ProtecaoDeApresentacao();
