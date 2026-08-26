// ============================================================
// MODO CORTE — a maquete que abre de verdade
// ------------------------------------------------------------
// O "Modo Corte" herdado ergue o volume superior. Funciona, é bonito, e
// continua no lugar — este módulo é OUTRA coisa: um plano de seção que
// atravessa a casa, como o corte de uma prancha de arquitetura. É a
// ferramenta que o corretor usa para explicar a distribuição sem sair do
// 3D, e é o recurso que separa uma visita virtual de uma apresentação de
// projeto.
//
// O PROBLEMA CENTRAL DO CLIPPING, E POR QUE STENCIL
// `THREE.Plane` em `material.clippingPlanes` recorta os fragmentos e
// pronto — mas as paredes desta casa são CAIXAS OCAS. Cortar uma caixa
// oca mostra o interior das faces de trás: a parede vira uma casca de
// papel com espessura zero, e o corte lê como erro de modelagem, não como
// seção. O olho percebe na hora.
//
// A tampa (o "cap") resolve isso, e o caminho é o stencil:
//   1. Desenha as faces DE TRÁS do sólido, sem cor, INCREMENTANDO o
//      stencil.
//   2. Desenha as faces DA FRENTE, sem cor, DECREMENTANDO.
//   3. Onde sobrou stencil diferente de zero, o plano foi atravessado por
//      um sólido — e é exatamente ali que a tampa deve aparecer.
//   4. Desenha um quadrilátero sobre o plano com esse teste de stencil.
//
// ONDE ELE É APLICADO, E O PREÇO
// Os passos 1 e 2 custam duas chamadas de desenho POR MALHA. A casa tem
// 124 malhas; aplicar em todas custaria 248 chamadas extras. Então a
// tampa é feita só nas malhas ESTRUTURAIS — parede, laje, piso, forro,
// núcleo de pedra. Sofá cortado oco quase não se nota; parede cortada oca
// destrói a leitura. Móvel e vegetação são só recortados.
//
// Isso vale ainda mais porque o corte é um modo DELIBERADO: o usuário
// parou para estudar a planta, não está sobrevoando a casa. Pagar
// algumas dezenas de chamadas aqui é barato; pagá-las o tempo todo não
// seria.
// ============================================================
import * as THREE from 'three';

/** Materiais que formam o casco. Só estes ganham tampa. */
const ESTRUTURAIS = new Set([
  'estuque', 'stoneCore', 'concreto', 'cumaru', 'forroMadeira',
  'travertino', 'ipe', 'madeiraClara', 'grafite', 'terraco',
]);

/**
 * O SÍTIO NÃO SE CORTA. Gramado, mata, árvores, canteiros e o campo
 * distante ficam de fora do plano de clipping.
 *
 * Isto não é preciosismo: `houseGroup` contém o terreno, e na primeira
 * versão o plano foi aplicado a TODO material encontrado ali. O resultado
 * era que metade do mundo desaparecia — o gramado sumia e no lugar dele
 * aparecia o fundo, um lençol creme ocupando meia tela. Passei um bom
 * tempo culpando a tampa de stencil por isso, até medir: a tampa cobria
 * 4,9% do quadro, exatamente como devia. Quem sumia era o chão.
 *
 * Um corte de arquitetura secciona o EDIFÍCIO e deixa o terreno inteiro.
 * É assim numa prancha e é assim aqui.
 */
const SITIO = new Set([
  'gramado', 'campoDistante', 'troncoArvore', 'copaArvore', 'arbusto',
  'graminea', 'canteiro', 'cascalho', 'pedraJardim', 'vaso',
  'caminho', 'meioFio',
]);

export type Eixo = 'x' | 'y' | 'z';

interface CenaMinima {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  houseGroup: THREE.Object3D | null;
  M: Record<string, THREE.Material>;
}

/**
 * Envelope construído, cópia literal de `HOUSE_ENVELOPE` no legado — a
 * mesma caixa que a cena usa para decidir se a câmera atravessaria a casa.
 *
 * NÃO usar `Box3.setFromObject(houseGroup)`: o grupo contém o terreno, e o
 * gramado tem 900 m de lado. A caixa saía com ±450 m, o que produzia dois
 * defeitos de uma vez — o plano de corte a 45 m da casa (removendo-a
 * inteira, não cortando) e uma tampa de 1440 m, que é literalmente um
 * lençol na frente da câmera. Foi o que apareceu no primeiro render: a
 * casa sumia e a tela ficava creme.
 */
const ENVELOPE = {
  x: [-13.4, 12.4] as const,
  y: [-0.2, 7.0] as const,
  z: [-6.4, 6.3] as const,
};

const NORMAIS: Record<Eixo, THREE.Vector3> = {
  x: new THREE.Vector3(-1, 0, 0),
  y: new THREE.Vector3(0, -1, 0),
  z: new THREE.Vector3(0, 0, -1),
};

export class CutMode {
  private cena: CenaMinima | null = null;
  private plano = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private grupoStencil = new THREE.Group();
  private grupoFantasma = new THREE.Group();
  private tampa: THREE.Mesh | null = null;
  private materiais: THREE.Material[] = [];
  private caixa = new THREE.Box3();
  private eixo: Eixo = 'x';
  private _ativo = false;
  private _fantasma = true;
  /** Posição normalizada do plano dentro da caixa da casa. */
  private t = 0.5;
  private alvoT = 0.5;
  private preparado = false;

  ligar(cena: CenaMinima): void {
    this.cena = cena;
  }

  get ativo(): boolean {
    return this._ativo;
  }

  /**
   * Prepara tudo na PRIMEIRA ativação, não no boot. Atribuir
   * `clippingPlanes` obriga o Three.js a recompilar todo material tocado,
   * e fazer isso durante o carregamento adicionaria uma pausa a um
   * momento em que o cliente já está esperando. Aqui a pausa acontece
   * quando ele pediu o corte — e aí ela é uma resposta ao clique dele.
   */
  private preparar(): void {
    if (this.preparado || !this.cena) return;
    const { scene, renderer, houseGroup, M } = this.cena;
    if (!houseGroup) return;
    this.preparado = true;

    renderer.localClippingEnabled = true;
    this.caixa.set(
      new THREE.Vector3(ENVELOPE.x[0], ENVELOPE.y[0], ENVELOPE.z[0]),
      new THREE.Vector3(ENVELOPE.x[1], ENVELOPE.y[1], ENVELOPE.z[1]),
    );

    const nomePorMaterial = new Map<THREE.Material, string>();
    for (const [k, v] of Object.entries(M)) nomePorMaterial.set(v, k);

    const vistos = new Set<THREE.Material>();
    this.grupoStencil = new THREE.Group();
    this.grupoStencil.name = 'casaAura_stencilCorte';
    this.grupoFantasma = new THREE.Group();
    this.grupoFantasma.name = 'casaAura_fantasmaCorte';

    houseGroup.updateMatrixWorld(true);
    houseGroup.traverse((o) => {
      const malha = o as THREE.Mesh;
      if (!malha.isMesh || !malha.geometry) return;
      const mats = Array.isArray(malha.material) ? malha.material : [malha.material];

      let estrutural = false;
      for (const m of mats) {
        if (!m) continue;
        const nome = nomePorMaterial.get(m);
        if (nome && SITIO.has(nome)) continue;   // terreno nao se corta
        if (!vistos.has(m)) {
          vistos.add(m);
          m.clippingPlanes = [this.plano];
          m.clipShadows = true;
          m.needsUpdate = true;
          this.materiais.push(m);
        }
        if (nome && ESTRUTURAIS.has(nome)) estrutural = true;
      }
      if (!estrutural) return;
      if (!this.eSolidoFechado(malha)) { this.chapasIgnoradas++; return; }

      this.grupoStencil.add(
        this.faceDeStencil(malha, THREE.BackSide, THREE.IncrementWrapStencilOp, 1),
        this.faceDeStencil(malha, THREE.FrontSide, THREE.DecrementWrapStencilOp, 2),
      );
      this.grupoFantasma.add(this.criarFantasma(malha));
    });

    this.grupoStencil.visible = false;
    this.grupoFantasma.visible = false;
    scene.add(this.grupoStencil, this.grupoFantasma);
    this.criarTampa(scene);

    console.info(
      `[corte] ${this.grupoStencil.children.length / 2} malhas estruturais com tampa, ` +
      `${this.materiais.length} materiais recortados, ` +
      `${this.chapasIgnoradas} chapas sem tampa (nao sao solidos fechados)`,
    );
  }

  private chapasIgnoradas = 0;

  /**
   * A conta de incrementa-atrás / decrementa-na-frente SÓ FECHA em sólido
   * fechado. Uma chapa — piso em `PlaneGeometry`, uma laje de espessura
   * zero, um deck — tem face de frente e nenhuma face de trás atrás dela:
   * o stencil incrementa e nada decrementa, e a tampa passa a ser
   * desenhada sobre a projeção inteira daquela chapa.
   *
   * Nesta casa a filtragem pega UMA malha só — cheguei a ela suspeitando
   * que fosse a causa do lençol branco no primeiro render, e não era (a
   * causa foi a caixa de 900 m, ver ENVELOPE acima). A guarda fica porque
   * continua correta e porque a próxima laje fina que alguém acrescentar
   * quebraria a tampa em silêncio.
   *
   * O teste é geométrico e não depende de nome: uma chapa tem espessura
   * desprezível em algum eixo. 2 cm é o menor elemento construtivo real
   * desta casa (o vidro tem 2 cm); abaixo disso é superfície, não sólido.
   */
  private eSolidoFechado(malha: THREE.Mesh): boolean {
    const g = malha.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) return false;
    const d = bb.max.clone().sub(bb.min);
    return d.x > 0.02 && d.y > 0.02 && d.z > 0.02;
  }

  /**
   * Uma face de stencil reaproveita a GEOMETRIA do original — não copia
   * vértice nenhum. O que se cria é um Object3D a mais apontando para o
   * mesmo buffer, com a matriz de mundo congelada.
   */
  private faceDeStencil(
    original: THREE.Mesh,
    lado: THREE.Side,
    op: THREE.StencilOp,
    ordem: number,
  ): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      depthWrite: false,
      depthTest: false,
      colorWrite: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      side: lado,
    });
    mat.clippingPlanes = [this.plano];
    mat.stencilFail = op;
    mat.stencilZFail = op;
    mat.stencilZPass = op;

    const m = new THREE.Mesh(original.geometry, mat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(original.matrixWorld);
    m.renderOrder = ordem;
    m.frustumCulled = false;   // a matriz congelada confunde o culling
    return m;
  }

  /**
   * O "fantasma": a parte REMOVIDA pelo corte, desenhada em arame. Sem
   * ele o corte é ambíguo — não dá para saber se a casa termina ali ou se
   * foi cortada. Com ele, lê-se imediatamente como seção.
   * Usa o plano INVERTIDO, então mostra exatamente o complemento.
   */
  private criarFantasma(original: THREE.Mesh): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc9a227,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      toneMapped: false,
    });
    mat.clippingPlanes = [this.planoInverso];
    const m = new THREE.Mesh(original.geometry, mat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(original.matrixWorld);
    m.frustumCulled = false;
    m.renderOrder = 4;
    return m;
  }

  /** Plano oposto, para o fantasma. Mantido em sincronia por `aplicar()`. */
  private planoInverso = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

  private criarTampa(scene: THREE.Scene): void {
    // 1,15 e nao 1,6: a tampa so precisa cobrir a secao da CASA. Folga
    // demais aqui volta a ser um plano gigante flutuando no jardim assim
    // que o stencil erra por um pixel.
    const tamanho = Math.max(
      this.caixa.max.x - this.caixa.min.x,
      this.caixa.max.y - this.caixa.min.y,
      this.caixa.max.z - this.caixa.min.z,
    ) * 1.15;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xe6e0d4,
      metalness: 0.0,
      roughness: 0.85,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      // Onde o stencil NÃO é zero, um sólido atravessou o plano.
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });

    const m = new THREE.Mesh(new THREE.PlaneGeometry(tamanho, tamanho), mat);
    m.renderOrder = 3;
    m.frustumCulled = false;
    // O stencil é acumulado por quadro. Sem esta limpeza, o lixo do quadro
    // anterior sobrevive e a tampa aparece em lugares onde não há sólido.
    m.onAfterRender = (renderer) => renderer.clearStencil();
    this.tampa = m;
    m.visible = false;
    scene.add(m);
  }

  // ------------------------------------------------------------
  alternar(eixo: Eixo = this.eixo): boolean {
    if (this._ativo && eixo === this.eixo) {
      this.desativar();
      return false;
    }
    this.ativar(eixo);
    return true;
  }

  ativar(eixo: Eixo = 'x'): void {
    this.preparar();
    if (!this.preparado) return;
    this.eixo = eixo;
    this._ativo = true;
    this.grupoStencil.visible = true;
    this.grupoFantasma.visible = this._fantasma;
    if (this.tampa) this.tampa.visible = true;
    this.aplicar();
  }

  desativar(): void {
    if (!this.preparado) return;
    this._ativo = false;
    this.grupoStencil.visible = false;
    this.grupoFantasma.visible = false;
    if (this.tampa) this.tampa.visible = false;
    // Empurra o plano para fora da casa em vez de esvaziar
    // `clippingPlanes`: mexer no array força recompilação de 40 materiais,
    // e o usuário sentiria isso como um engasgo ao FECHAR o corte.
    this.plano.constant = 1e4;
    this.planoInverso.constant = -1e4;
  }

  /** Posição do plano, de 0 a 1 ao longo do eixo escolhido. */
  set posicao(v: number) {
    this.alvoT = Math.max(0, Math.min(1, v));
  }
  get posicao(): number {
    return this.t;
  }

  set fantasma(v: boolean) {
    this._fantasma = v;
    this.grupoFantasma.visible = v && this._ativo;
  }

  private aplicar(): void {
    const n = NORMAIS[this.eixo];
    const min = this.caixa.min[this.eixo];
    const max = this.caixa.max[this.eixo];
    // Uma folga em cada ponta para o extremo do curso não deixar a casa
    // inteira de fora nem inteira dentro.
    const d = min + (max - min) * this.t;

    this.plano.normal.copy(n);
    // Para normal (-1,0,0), o plano é `-x + c = 0`, ou seja `x = c`.
    this.plano.constant = d;
    this.planoInverso.normal.copy(n).negate();
    this.planoInverso.constant = -d;

    const tp = this.tampa;
    if (!tp) return;
    const centro = this.caixa.getCenter(new THREE.Vector3());
    centro[this.eixo] = d;
    tp.position.copy(centro);
    tp.lookAt(centro.clone().add(n));
    // Um fio à frente do plano: coplanar exato produz z-fighting com a
    // própria geometria que o gerou.
    tp.translateZ(-0.001);
  }

  /** Chamar por quadro. Anima o deslize do plano. */
  atualizar(dt: number): void {
    if (!this._ativo) return;
    if (Math.abs(this.alvoT - this.t) < 0.0005) {
      if (this.t !== this.alvoT) { this.t = this.alvoT; this.aplicar(); }
      return;
    }
    this.t += (this.alvoT - this.t) * Math.min(1, dt * 6);
    this.aplicar();
  }

  destruir(): void {
    for (const m of this.materiais) {
      m.clippingPlanes = null;
      m.needsUpdate = true;
    }
    this.materiais = [];
    for (const g of [this.grupoStencil, this.grupoFantasma]) {
      g.traverse((o) => {
        const mm = (o as THREE.Mesh).material;
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else mm?.dispose();
      });
      g.parent?.remove(g);
    }
    if (this.tampa) {
      this.tampa.geometry.dispose();
      (this.tampa.material as THREE.Material).dispose();
      this.tampa.parent?.remove(this.tampa);
      this.tampa = null;
    }
    this.preparado = false;
    this._ativo = false;
  }
}

export const corte = new CutMode();
