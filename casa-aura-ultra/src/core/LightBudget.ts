// ============================================================
// ORÇAMENTO DE LUZ
// ------------------------------------------------------------
// No Three.js cada luz real entra no LAÇO do fragment shader. Não é um
// custo fixo por quadro: é custo por PIXEL, multiplicado pelo número de
// luzes. Numa GPU móvel, com a casa ocupando a tela inteira, a diferença
// entre 6 e 14 pontos de luz é a diferença entre fluido e travado — e
// pior, o Three.js RECOMPILA todos os shaders quando a contagem muda, o
// que produz um engasgo no exato momento em que as luminárias acendem ao
// anoitecer.
//
// A cena acende as luminárias em sequência áurea conforme escurece, e
// nunca teve teto. Este módulo põe o teto, e o põe por TIER — porque o
// problema não existe no desktop.
//
// O QUE ACONTECE COM AS LUZES CORTADAS
// Elas não somem da cena: ficam `visible = false`, o que as tira do
// cálculo de iluminação sem destruir nada. E o abajur continua ACESO,
// porque a cena já mantém uma lista separada de `emissiveFixtures` — o
// material da cúpula brilha sozinho, sem custo de iluminação. Ou seja: o
// cliente continua vendo a casa acesa; o que ele deixa de receber é a
// contribuição de luz daquele ponto no ambiente ao redor.
//
// COMO SE ESCOLHE QUEM FICA
// Por distância à câmera, reavaliado devagar. Uma luminária a 30 m
// contribui quase nada e é a primeira a sair; a do cômodo em que a câmera
// está é a que mais importa. Reavaliar devagar é essencial: trocar o
// conjunto de luzes ativas a cada quadro recompilaria shaders sem parar.
// ============================================================
import * as THREE from 'three';

/**
 * Quantas luzes de luminária cada tier aguenta, além do rig fixo
 * (ambiente + hemisfério + sol).
 *
 * OS NÚMEROS SÃO MEDIDOS, e a primeira versão deles estava errada. Eu
 * escrevi este módulo supondo que a cena acendesse uma dúzia de pontos ao
 * anoitecer e pus o teto de `medium` em 6. Contando de verdade: a cena tem
 * 5 luminárias e 9 luzes no total. Com teto 6 este arquivo inteiro não
 * cortava NADA — era um botão morto, do mesmo tipo que este projeto passou
 * a sessão inteira encontrando.
 *
 * Com 5 luminárias, o que vincula de verdade é: 4 no tier `medium`
 * (5 -> 4 pontos no laço do fragment shader) e 2 no `low`. Não é a
 * economia dramática que eu imaginei — é a economia que existe.
 */
const TETO: Record<string, number> = {
  ultra: 99,   // sem teto na prática
  high: 99,    // desktop dá conta das 5 sem discussão
  medium: 4,
  low: 2,
};

/**
 * Reavaliação lenta. 2,5 s é longo o bastante para que andar pela casa
 * não fique trocando o conjunto, e curto o bastante para que ao chegar
 * num cômodo a luz dele esteja ativa antes de o usuário reparar.
 */
const INTERVALO_MS = 2500;
/**
 * Só troca se a ordem mudar de verdade. Sem esta histerese, duas luzes a
 * distâncias parecidas ficariam alternando na fronteira do corte — e cada
 * alternância é uma recompilação de shader.
 */
const MARGEM_M = 2.0;

// Reaproveitado a cada avaliação: alocar um Vector3 por luz a cada ciclo
// seria lixo desnecessário no coletor.
const _v = new THREE.Vector3();

export class LightBudget {
  private luzes: THREE.Light[] = [];
  private camera: THREE.Camera | null = null;
  private teto = 99;
  private ultimaAvaliacao = 0;
  private ativasAgora = new Set<THREE.Light>();
  private _cortadas = 0;

  ligar(luzes: THREE.Light[], camera: THREE.Camera, nivel: string): void {
    this.luzes = luzes.filter(Boolean);
    this.camera = camera;
    this.teto = TETO[nivel] ?? TETO.medium;
    if (this.luzes.length <= this.teto) {
      console.info(
        `[luz] ${this.luzes.length} luminárias, teto ${this.teto} no tier ${nivel} — nada a cortar`,
      );
      return;
    }
    this.avaliar(true);
    console.info(
      `[luz] ${this.luzes.length} luminárias, teto ${this.teto} no tier ${nivel} — ` +
      `${this._cortadas} desligadas (as cúpulas seguem emissivas)`,
    );
  }

  /** Chamar por quadro; ela própria decide quando vale reavaliar. */
  quadro(): void {
    if (!this.camera || this.luzes.length <= this.teto) return;
    const agora = performance.now();
    if (agora - this.ultimaAvaliacao < INTERVALO_MS) return;
    this.ultimaAvaliacao = agora;
    this.avaliar(false);
  }

  private avaliar(forcar: boolean): void {
    const cam = this.camera;
    if (!cam) return;

    const ordenadas = this.luzes
      .map((l) => ({ l, d: l.getWorldPosition(_v).distanceTo(cam.position) }))
      .sort((a, b) => a.d - b.d);

    const novas = new Set<THREE.Light>();
    for (let i = 0; i < Math.min(this.teto, ordenadas.length); i++) {
      novas.add(ordenadas[i].l);
    }

    if (!forcar && !this.mudouDeVerdade(novas, ordenadas)) return;

    this._cortadas = 0;
    for (const l of this.luzes) {
      const ativa = novas.has(l);
      // Não toca em quem já está no estado certo: atribuir `visible`
      // sempre é barato, mas manter a checagem deixa claro que a troca é
      // rara de propósito.
      if (l.visible !== ativa) l.visible = ativa;
      if (!ativa) this._cortadas++;
    }
    this.ativasAgora = novas;
  }

  /**
   * Só aceita a troca quando a candidata de fora está MARGEM_M mais perto
   * que a pior de dentro. Isso é a histerese que evita o pisca-pisca de
   * recompilação na fronteira.
   */
  private mudouDeVerdade(
    novas: Set<THREE.Light>,
    ordenadas: { l: THREE.Light; d: number }[],
  ): boolean {
    let igual = novas.size === this.ativasAgora.size;
    if (igual) {
      for (const l of novas) if (!this.ativasAgora.has(l)) { igual = false; break; }
    }
    if (igual) return false;

    const dentro = ordenadas.filter((x) => this.ativasAgora.has(x.l));
    const fora = ordenadas.filter((x) => !this.ativasAgora.has(x.l));
    if (!dentro.length || !fora.length) return true;
    const piorDentro = dentro[dentro.length - 1].d;
    const melhorFora = fora[0].d;
    return melhorFora < piorDentro - MARGEM_M;
  }

  get diagnostico(): { total: number; teto: number; ativas: number; cortadas: number } {
    return {
      total: this.luzes.length,
      teto: this.teto,
      ativas: this.luzes.filter((l) => l.visible).length,
      cortadas: this._cortadas,
    };
  }
}

export const orcamentoDeLuz = new LightBudget();
