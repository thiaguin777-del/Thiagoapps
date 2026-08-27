// ============================================================
// PÓS-PROCESSAMENTO — o que faltava na cadeia herdada
// ------------------------------------------------------------
// A cena já monta um EffectComposer com RenderPass, GTAO, UnrealBloom,
// color grade, vinheta e grão. Este módulo NÃO reconstrói essa cadeia:
// ela foi calibrada renderizando, e o passe de grade inclusive carrega o
// tone mapping ACES à mão porque o composer curto-circuita o tone mapping
// do renderizador. Refazer tudo perderia isso.
//
// O que este módulo acrescenta são as duas coisas que faltavam:
//
// 1. ANTI-ALIASING — E ISTO ERA UM BUG DE VERDADE.
//    O renderizador é criado com `antialias: true`, mas o MSAA do
//    `antialias` vive no framebuffer padrão, e quando há composer a cena
//    NUNCA é desenhada nele: vai para os render targets do composer, que
//    o Three.js cria sem `samples`. Resultado: nos tiers ultra, high e
//    medium — exatamente os que têm pós-processamento — a cena roda com
//    zero anti-aliasing. Numa casa que é feita de linhas de telhado,
//    montantes de esquadria e guarda-corpo, é o defeito mais visível que
//    existe, e ele estava escondido atrás de uma flag que parecia ligada.
//
//    Correção por tier, e a escolha é técnica:
//      ultra/high  MSAA 4x nos alvos do composer. Para aresta de
//                  geometria — que é 90% de uma foto de arquitetura —
//                  MSAA é estritamente melhor que qualquer AA de tela,
//                  porque tem informação de subpixel real em vez de
//                  adivinhar a partir do resultado já achatado.
//      medium      SMAA. MSAA em alvo HalfFloat pesa banda de memória, e
//                  banda é justamente o que falta em GPU móvel. SMAA
//                  custa dois passes pequenos e nenhuma memória extra
//                  por amostra.
//      low         Nada — o tier low nem monta composer.
//
// 2. PROFUNDIDADE DE CAMPO — LIGADA SÓ QUANDO FAZ SENTIDO.
//    O BokehPass precisa de um render de profundidade da cena inteira.
//    Isso é caro, e o efeito é ativamente RUIM durante a exploração
//    livre: quem está girando a câmera quer ver tudo nítido, e o
//    desfoque briga com o olhar do usuário.
//    Então o DOF só existe no tier ultra e só liga nos estados em que a
//    câmera está em trilho e o enquadramento foi composto — CINEMATIC e
//    PRESENTATION. Nos outros ele fica `enabled = false`, e passe
//    desligado no Three.js não custa nada: nem o render de profundidade
//    acontece.
// ============================================================
import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/** O mínimo do EffectComposer que precisamos, sem depender do tipo dele. */
interface ComposerLike {
  passes: { enabled: boolean; constructor: { name: string } }[];
  renderTarget1: THREE.WebGLRenderTarget;
  renderTarget2: THREE.WebGLRenderTarget;
  insertPass(pass: unknown, index: number): void;
  addPass(pass: unknown): void;
}

export interface AlvoPos {
  composer: ComposerLike | null;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  nivel: 'ultra' | 'high' | 'medium' | 'low';
}

/** Distância de foco em metros e abertura, animadas pelo rack focus. */
interface EstadoFoco {
  foco: number;
  abertura: number;
  alvoFoco: number;
  alvoAbertura: number;
  /** Segundos restantes da transição em curso. */
  restante: number;
  /** Abertura no MEIO da viagem; nas pontas ela volta ao padrão. */
  aberturaDePico: number;
  duracao: number;
  deFoco: number;
  deAbertura: number;
}

const ABERTURA_PADRAO = 0.0016;

export class PostProcessing {
  private bokeh: BokehPass | null = null;
  private smaa: SMAAPass | null = null;
  private msaa = false;
  private est: EstadoFoco = {
    foco: 12, abertura: ABERTURA_PADRAO,
    alvoFoco: 12, alvoAbertura: ABERTURA_PADRAO,
    restante: 0, duracao: 0, deFoco: 12, deAbertura: ABERTURA_PADRAO,
    aberturaDePico: ABERTURA_PADRAO,
  };

  aprimorar(alvo: AlvoPos): void {
    const c = alvo.composer;
    if (!c) return;   // tier low: render direto, nada a fazer

    this.ligarStencil(c);
    this.ligarAntiAliasing(c, alvo);
    if (alvo.nivel === 'ultra') this.ligarProfundidadeDeCampo(c, alvo);
  }

  // ------------------------------------------------------------
  /**
   * O EffectComposer cria os render targets como
   * `new WebGLRenderTarget(w, h, { type: HalfFloatType })` — e o padrão de
   * `stencilBuffer` é FALSO. Quando há composer, portanto, a cena é
   * desenhada num alvo SEM stencil.
   *
   * Consequência medida: o Modo Seção pintava a tela inteira de creme. A
   * tampa do corte é desenhada com `stencilFunc: NotEqual, stencilRef: 0`,
   * e sem buffer de stencil esse teste passa em todo pixel — a tampa
   * deixava de ser a tampa e virava um plano gigante na frente da casa.
   *
   * É o mesmo padrão do bug do anti-aliasing: uma capacidade que o
   * renderizador tem, que o composer silenciosamente não carrega adiante.
   */
  private ligarStencil(c: ComposerLike): void {
    for (const alvo of [c.renderTarget1, c.renderTarget2]) {
      if (alvo.stencilBuffer) continue;
      alvo.stencilBuffer = true;
      alvo.dispose();   // força recriar a textura com o anexo de stencil
    }
  }

  // ------------------------------------------------------------
  private ligarAntiAliasing(c: ComposerLike, alvo: AlvoPos): void {
    const webgl2 = alvo.renderer.capabilities.isWebGL2;

    if ((alvo.nivel === 'ultra' || alvo.nivel === 'high') && webgl2) {
      // Os dois alvos precisam de samples porque o composer os alterna
      // como leitura/escrita, e o RenderPass pode cair em qualquer um.
      c.renderTarget1.samples = 4;
      c.renderTarget2.samples = 4;
      // Força a recriação: `samples` só vale a partir do próximo upload.
      c.renderTarget1.dispose();
      c.renderTarget2.dispose();
      this.msaa = true;
      return;
    }

    // SMAA vai no FIM da cadeia, depois do grão. Antes do grão ele
    // suavizaria arestas que o grão volta a sujar; depois, ele trata a
    // imagem final, que é a que o cliente vê.
    this.smaa = new SMAAPass(
      window.innerWidth * alvo.renderer.getPixelRatio(),
      window.innerHeight * alvo.renderer.getPixelRatio(),
    );
    c.addPass(this.smaa);
  }

  // ------------------------------------------------------------
  private ligarProfundidadeDeCampo(c: ComposerLike, alvo: AlvoPos): void {
    this.bokeh = new BokehPass(alvo.scene, alvo.camera, {
      focus: this.est.foco,
      // Abertura pequena de propósito. O padrão do BokehPass (0,025) numa
      // cena em escala real de metros desfoca a casa inteira a partir de
      // dois metros — vira miniatura de maquete. Uma lente de arquitetura
      // real é fechada: quase tudo nítido, com o fundo só insinuado.
      aperture: ABERTURA_PADRAO,
      maxblur: 0.008,
    });
    this.bokeh.enabled = false;

    // Antes do bloom: highlight desfocado que depois floresce é o que
    // produz bokeh de verdade. Na ordem inversa o bloom fica nítido em
    // cima de uma imagem borrada, e lê como erro.
    const iBloom = c.passes.findIndex((p) => /Bloom/i.test(p.constructor.name));
    const iGrade = c.passes.findIndex((p) => /ShaderPass/i.test(p.constructor.name));
    const idx = iBloom >= 0 ? iBloom : (iGrade >= 0 ? iGrade : c.passes.length);
    c.insertPass(this.bokeh, idx);
  }

  // ------------------------------------------------------------
  /**
   * Liga/desliga o DOF. Chamado pela máquina de estados: só CINEMATIC e
   * PRESENTATION o querem.
   */
  set profundidadeDeCampo(ligado: boolean) {
    if (this.bokeh) this.bokeh.enabled = ligado;
  }

  get temProfundidadeDeCampo(): boolean {
    return this.bokeh !== null;
  }

  get temAntiAliasing(): 'msaa' | 'smaa' | 'nenhum' {
    if (this.msaa) return 'msaa';
    return this.smaa ? 'smaa' : 'nenhum';
  }

  /**
   * RACK FOCUS — a transição de foco entre dois planos, feita com a
   * câmera parada. É o recurso mais expressivo de cinema que existe e
   * quase nenhuma visita virtual usa: em vez de mover a câmera para
   * mostrar o segundo assunto, o foco viaja até ele e o primeiro se
   * dissolve. Abre também a abertura durante a viagem, porque é assim que
   * uma lente real se comporta quando o operador puxa o foco rápido.
   */
  puxarFoco(distancia: number, duracao = 1.4, abertura = ABERTURA_PADRAO * 2.6): void {
    const e = this.est;
    e.deFoco = e.foco;
    e.deAbertura = e.abertura;
    e.alvoFoco = distancia;
    // A abertura ABRE durante a viagem e FECHA de volta ao chegar. Antes
    // ela só abria: o primeiro rack focus deixava a lente em 2,6x a
    // abertura calibrada e o resto do filme inteiro rodava com a
    // profundidade de campo errada, cada vez mais rasa a cada plano.
    // Uma lente real volta ao diafragma de trabalho quando o operador
    // solta o foco.
    e.alvoAbertura = ABERTURA_PADRAO;
    e.aberturaDePico = abertura;
    e.duracao = Math.max(0.05, duracao);
    e.restante = e.duracao;
  }

  /** Define o foco sem animação — usado ao entrar num plano novo. */
  focarEm(distancia: number): void {
    const e = this.est;
    e.foco = e.alvoFoco = e.deFoco = distancia;
    e.restante = 0;
    this.aplicar();
  }

  atualizar(dt: number): void {
    if (!this.bokeh || !this.bokeh.enabled) return;
    const e = this.est;
    if (e.restante > 0) {
      e.restante = Math.max(0, e.restante - dt);
      const t = 1 - e.restante / e.duracao;
      // Ease in-out: o operador de foco acelera e desacelera; uma rampa
      // linear é a assinatura de foco automático, não de foco humano.
      const s = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      e.foco = e.deFoco + (e.alvoFoco - e.deFoco) * s;
      // Sino: fechada -> aberta no meio -> fechada. `sin(pi*t)` vale 0
      // nas duas pontas e 1 no meio, que é exatamente o comportamento de
      // um diafragma acompanhando uma puxada de foco.
      const sino = Math.sin(Math.PI * t);
      e.abertura = e.deAbertura
        + (e.alvoAbertura - e.deAbertura) * s
        + (e.aberturaDePico - ABERTURA_PADRAO) * sino;
    }
    this.aplicar();
  }

  private aplicar(): void {
    const u = this.bokeh?.uniforms as
      | { focus: { value: number }; aperture: { value: number } }
      | undefined;
    if (!u) return;
    u.focus.value = this.est.foco;
    u.aperture.value = this.est.abertura;
  }

  redimensionar(largura: number, altura: number): void {
    this.smaa?.setSize(largura, altura);
    this.bokeh?.setSize(largura, altura);
  }
}

export const pos = new PostProcessing();
