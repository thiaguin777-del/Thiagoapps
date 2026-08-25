// ============================================================
// QUALITY CONTROLLER — degradação em degraus, e anunciada
// ------------------------------------------------------------
// A promessa do produto é fluidez em qualquer aparelho. Como a lista de
// aparelhos é desconhecida, a única defesa possível é reagir ao que está
// acontecendo AGORA, não ao que o user-agent diz.
//
// Três degraus, do mais barato ao mais drástico, nesta ordem de propósito:
//
//   1. pixelRatio  −0.25   Invisível na prática e devolve muito: o custo
//                          de preenchimento cai com o QUADRADO da escala.
//   2. SSAO/GTAO off       Um passe inteiro a menos. O contato nas
//                          quinas some, mas a cena continua a mesma.
//   3. Modo Leve           Sem pós-processamento, sem partículas. É a
//                          rede de segurança, e é ANUNCIADA — o cliente
//                          merece saber por que a imagem mudou.
//
// A janela é de 2 s e exige 3 janelas ruins seguidas. Reagir a um pico
// isolado seria pior que não reagir: a imagem piora por um engasgo que já
// passou, e o usuário vê a degradação sem entender.
// ============================================================
import type * as THREE from 'three';
import { analytics } from './Analytics';

export type NivelDegradacao = 0 | 1 | 2 | 3;

interface Alvo {
  renderer: THREE.WebGLRenderer;
  composer: { passes: { enabled: boolean; constructor: { name: string } }[] } | null;
  /** Chamado quando o Modo Leve liga/desliga. */
  aoModoLeve?: (ligado: boolean) => void;
}

const JANELA_MS = 2000;
const JANELAS_RUINS = 3;
const FPS_RUIM = 30;
const FPS_CRITICO = 20;
const FPS_MODO_LEVE = 15;
const PIXEL_RATIO_MINIMO = 0.5;

export class QualityController {
  private alvo: Alvo | null = null;
  private quadros = 0;
  private inicioJanela = performance.now();
  private ruins = 0;
  private criticas = 0;
  public nivel: NivelDegradacao = 0;
  public modoLeve = false;
  public fpsAtual = 60;
  /** Desliga o auto-scaler. Usado por ?q= para auditoria com tier travado. */
  public travado = false;

  ligar(alvo: Alvo): void {
    this.alvo = alvo;
    this.travado = new URLSearchParams(location.search).has('q');
    if (this.travado) {
      console.info('[qualidade] auto-scaler DESLIGADO por ?q= — modo auditoria');
    }
  }

  /** Chamar uma vez por quadro, do laço de render. */
  quadro(): void {
    this.quadros++;
    const agora = performance.now();
    const dt = agora - this.inicioJanela;
    if (dt < JANELA_MS) return;

    this.fpsAtual = (this.quadros * 1000) / dt;
    this.quadros = 0;
    this.inicioJanela = agora;
    if (this.travado || !this.alvo) return;

    if (this.fpsAtual < FPS_MODO_LEVE) {
      // Abaixo de 15 fps não há degrau intermediário que salve. Vai direto
      // para a rede de segurança em vez de descer um degrau a cada 6 s
      // enquanto o cliente olha uma apresentação travada.
      this.criticas++;
      if (this.criticas >= 2) this.ativarModoLeve();
      return;
    }
    this.criticas = 0;

    if (this.fpsAtual >= FPS_RUIM) {
      this.ruins = 0;
      return;
    }
    this.ruins++;
    if (this.ruins < JANELAS_RUINS) return;
    this.ruins = 0;
    this.descerUmDegrau();
  }

  private descerUmDegrau(): void {
    const a = this.alvo!;
    if (this.nivel === 0) {
      const atual = a.renderer.getPixelRatio();
      const novo = Math.max(PIXEL_RATIO_MINIMO, atual - 0.25);
      if (novo < atual) {
        a.renderer.setPixelRatio(novo);
        this.registrar(1, `pixelRatio ${atual.toFixed(2)} -> ${novo.toFixed(2)}`);
        // Só avança de nível quando o pixelRatio chega no piso; até lá,
        // continua descendo por este degrau, que é o mais barato.
        if (novo > PIXEL_RATIO_MINIMO) return;
      }
      this.nivel = 1;
      return;
    }
    if (this.nivel === 1) {
      const p = a.composer?.passes.find((x) =>
        /GTAO|SSAO/i.test(x.constructor.name));
      if (p) p.enabled = false;
      this.nivel = 2;
      this.registrar(2, 'oclusão de ambiente desligada');
      return;
    }
    if (this.nivel === 2) {
      this.ativarModoLeve();
    }
  }

  ativarModoLeve(): void {
    if (this.modoLeve || !this.alvo) return;
    this.modoLeve = true;
    this.nivel = 3;
    const a = this.alvo;
    if (a.composer) a.composer.passes.forEach((p, i) => { if (i > 0) p.enabled = false; });
    a.renderer.setPixelRatio(Math.min(a.renderer.getPixelRatio(), 1));
    a.aoModoLeve?.(true);
    this.registrar(3, 'Modo Leve');
    this.anunciar();
  }

  private anunciar(): void {
    if (document.getElementById('aviso-modo-leve')) return;
    const el = document.createElement('div');
    el.id = 'aviso-modo-leve';
    el.textContent = 'Modo Leve ativado para manter a navegação fluida neste aparelho.';
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 6000);
  }

  private registrar(nivel: number, oque: string): void {
    console.info(`[qualidade] ${this.fpsAtual.toFixed(0)} fps — degrau ${nivel}: ${oque}`);
    analytics.registrar('qualidade', { nivel, oque, fps: Math.round(this.fpsAtual) });
  }
}

export const qualidade = new QualityController();
