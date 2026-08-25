// ============================================================
// LUZ VOLUMÉTRICA — feixes de sol entrando pelas aberturas
// ------------------------------------------------------------
// POR QUE NÃO É UM PASSE DE TELA
// A implementação clássica de god rays em WebGL é um passe de blur
// radial sobre um render só das oclusões. Isso custa: um alvo extra do
// tamanho da tela, uma segunda passada da cena inteira para preenchê-lo,
// e um blur de 60-100 amostras por pixel. Num iPad isso é o orçamento de
// quadro inteiro — e o efeito ainda erra quando o sol está fora da tela,
// que é a maior parte do tempo numa visita a uma casa.
//
// Aqui os feixes são GEOMETRIA: um prisma por abertura, extrudado na
// direção do sol, desenhado com blend aditivo e sem escrita de
// profundidade. Custa uma chamada de desenho por feixe e nenhum alvo
// extra. Como as aberturas da casa são conhecidas e fixas, a posição de
// cada feixe é exata — melhor do que o passe de tela conseguiria.
//
// O preço honesto: os feixes não são ocluídos por móveis. Um sofá no
// caminho não corta o facho. Na prática isso não aparece porque os
// feixes entram acima da altura dos móveis, que é onde o sol rasante
// realmente entra numa casa de pé-direito alto.
//
// GOLDEN HOUR APENAS: ar visível exige luz rasante atravessando muito
// caminho. Ao meio-dia o sol entra quase vertical, o facho é curto e o
// efeito lê como neblina dentro de casa — errado, e denuncia o truque.
// A intensidade é uma curva em sino centrada no fim de tarde.
// ============================================================
import * as THREE from 'three';

const FEIXE_VERT = /* glsl */ `
  varying vec3 casaAura_local;
  varying vec3 casaAura_paraCamera;

  void main() {
    casaAura_local = position;
    vec4 mundo = modelMatrix * vec4(position, 1.0);
    casaAura_paraCamera = normalize(cameraPosition - mundo.xyz);
    gl_Position = projectionMatrix * viewMatrix * mundo;
  }
`;

const FEIXE_FRAG = /* glsl */ `
  uniform vec3 casaAura_cor;
  uniform float casaAura_intensidade;
  uniform vec3 casaAura_meia;        // meias dimensões do prisma, local
  uniform vec3 casaAura_direcaoSol;  // direção do feixe, em mundo
  uniform float casaAura_tempo;
  varying vec3 casaAura_local;
  varying vec3 casaAura_paraCamera;

  void main() {
    // 1. Queda ao longo do feixe: a luz se dispersa conforme avança.
    //    O eixo Z local é o comprimento (a geometria é construída assim).
    float ao_longo = (casaAura_local.z + casaAura_meia.z) / (2.0 * casaAura_meia.z);
    float queda = 1.0 - ao_longo;
    queda *= queda;

    // 2. Bordas macias na seção. Um prisma de arestas duras lê como
    //    caixa de vidro, não como ar iluminado.
    vec2 s = abs(casaAura_local.xy) / casaAura_meia.xy;
    float secao = (1.0 - smoothstep(0.55, 1.0, s.x))
                * (1.0 - smoothstep(0.55, 1.0, s.y));

    // 3. Anisotropia: um facho no ar é MUITO mais brilhante visto contra
    //    a direção de propagação. Sem isto ele tem o mesmo brilho de
    //    qualquer ângulo e vira um objeto sólido.
    float frente = clamp(dot(casaAura_paraCamera, casaAura_direcaoSol), 0.0, 1.0);
    float aniso = 0.25 + 0.75 * pow(frente, 2.5);

    // 4. Poeira em suspensão dentro do facho: variação lenta e sutil que
    //    impede o feixe de ser uma chapa de cor uniforme.
    float gr = sin(casaAura_local.x * 3.1 + casaAura_tempo * 0.35)
             * sin(casaAura_local.y * 2.7 - casaAura_tempo * 0.27);
    float grao = 0.88 + gr * 0.12;

    float a = queda * secao * aniso * grao * casaAura_intensidade;
    if (a <= 0.001) discard;
    gl_FragColor = vec4(casaAura_cor * a, a);
  }
`;

export interface Abertura {
  /** Centro da abertura em coordenadas de mundo. */
  posicao: THREE.Vector3;
  largura: number;
  altura: number;
  /** Até onde o facho avança dentro da casa, em metros. */
  alcance?: number;
  /**
   * Normal da abertura, apontando para FORA da casa. Serve para apagar o
   * feixe quando o sol está do outro lado da parede: sem esta checagem, a
   * fachada norte ganharia facho de sol poente, que é fisicamente
   * impossível e o olho percebe na hora.
   */
  normal: [number, number, number];
}

export class VolumetricLight {
  private grupo = new THREE.Group();
  private feixes: THREE.Mesh[] = [];
  private uTempo = { value: 0 };
  private uIntensidade = { value: 0 };
  private uCor = { value: new THREE.Color(0xffcf9a) };
  private uDirecao = { value: new THREE.Vector3(0, 0, 1) };
  private cena: THREE.Scene | null = null;
  /** Modo Leve: mantém o grupo montado, mas nunca visível. */
  private _suspenso = false;

  set suspenso(v: boolean) {
    this._suspenso = v;
    if (v) this.grupo.visible = false;
  }
  get suspenso(): boolean {
    return this._suspenso;
  }

  /**
   * Constrói um prisma por abertura. `direcaoSol` é o vetor DA fonte
   * PARA a cena — a direção em que o facho viaja.
   */
  construir(cena: THREE.Scene, aberturas: Abertura[], direcaoSol: THREE.Vector3): void {
    this.destruir();
    this.cena = cena;
    this.grupo = new THREE.Group();
    this.grupo.name = 'casaAura_feixes';
    this.grupo.renderOrder = 8;
    this.uDirecao.value.copy(direcaoSol).normalize();

    for (const ab of aberturas) {
      const alcance = ab.alcance ?? 9;
      // O prisma abre um pouco ao avançar: luz que entra por um vão se
      // espalha. Um cilindro de seção constante lê como tubo.
      const geo = new THREE.BoxGeometry(ab.largura, ab.altura, alcance, 1, 1, 1);
      const meia = new THREE.Vector3(ab.largura / 2, ab.altura / 2, alcance / 2);

      const mat = new THREE.ShaderMaterial({
        vertexShader: FEIXE_VERT,
        fragmentShader: FEIXE_FRAG,
        uniforms: {
          casaAura_cor: this.uCor,
          casaAura_intensidade: this.uIntensidade,
          casaAura_meia: { value: meia },
          casaAura_direcaoSol: this.uDirecao,
          casaAura_tempo: this.uTempo,
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        // Sem escrita de profundidade e sem descarte por profundidade em
        // ambas as faces: o facho é ar, não superfície. `depthTest` fica
        // LIGADO para o feixe não atravessar a parede oposta.
        depthWrite: false,
        depthTest: true,
        side: THREE.BackSide,
        toneMapped: false,
        fog: false,
      });

      const m = new THREE.Mesh(geo, mat);
      // Posiciona o centro do prisma meio alcance adiante da abertura e
      // aponta o eixo Z local na direção do sol.
      const centro = ab.posicao.clone().addScaledVector(this.uDirecao.value, alcance / 2);
      m.position.copy(centro);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.uDirecao.value);
      m.frustumCulled = true;
      m.userData.noMerge = true;
      m.userData.abertura = ab;
      this.feixes.push(m);
      this.grupo.add(m);
    }
    cena.add(this.grupo);
  }

  /**
   * Curva em sino sobre a hora solar (0 = manhã, 1 = noite). O pico fica
   * em 0,72, que é a hora dourada: sol baixo e ainda forte. Fora dessa
   * janela o efeito é zero — e zero significa `visible = false`, para
   * não pagar chamada de desenho por nada.
   */
  aplicarHoraSolar(t: number): void {
    // JANELA DURA antes do sino. Só o sino não bastava: medindo em
    // navegador, com t = 1,0 (noite fechada) a cauda da gaussiana ainda
    // entregava intensidade 0,048 e os fachos continuavam ligados. Facho
    // de sol depois do pôr do sol é o tipo de erro que destrói a
    // credibilidade da imagem inteira — e ele estava lá.
    if (this._suspenso || t < 0.48 || t > 0.86) {
      this.uIntensidade.value = 0;
      this.grupo.visible = false;
      return;
    }
    const d = (t - 0.72) / 0.19;
    const sino = Math.exp(-d * d);
    const i = sino < 0.04 ? 0 : sino * 0.42;
    this.uIntensidade.value = i;
    this.grupo.visible = i > 0;
    // A cor esquenta junto: o mesmo ar, com sol mais baixo, fica laranja.
    this.uCor.value.setHSL(0.09 - t * 0.02, 0.55 + t * 0.2, 0.62);
  }

  /**
   * Reaponta os feixes quando o sol se move, e apaga os que estão em
   * fachada que o sol não alcança.
   */
  reapontar(direcaoSol: THREE.Vector3): void {
    const d = this.uDirecao.value.copy(direcaoSol).normalize();
    const eixoZ = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3();
    for (const m of this.feixes) {
      const ab = m.userData.abertura as Abertura;
      n.set(...ab.normal).normalize();
      // A luz ENTRA quando viaja contra a normal externa da abertura.
      const entra = d.dot(n) < -0.08;
      m.visible = entra;
      if (!entra) continue;
      m.quaternion.setFromUnitVectors(eixoZ, d);
      const centro = new THREE.Vector3(...[ab.posicao.x, ab.posicao.y, ab.posicao.z])
        .addScaledVector(d, (ab.alcance ?? 9) / 2);
      m.position.copy(centro);
    }
  }

  atualizar(dt: number): void {
    if (this.grupo.visible) this.uTempo.value += dt;
  }

  get ativo(): boolean {
    return this.grupo.visible && this.feixes.length > 0;
  }

  destruir(): void {
    for (const m of this.feixes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.feixes = [];
    this.cena?.remove(this.grupo);
    this.cena = null;
  }
}

export const volumetrica = new VolumetricLight();
