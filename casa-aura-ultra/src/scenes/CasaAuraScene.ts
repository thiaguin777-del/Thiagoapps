// ============================================================
// CASA AURA — a camada de upgrade sobre a cena herdada
// ------------------------------------------------------------
// Este módulo é a costura. A cena (geometria, materiais, luzes, PMREM,
// oclusão de interior) continua vindo do legado, que foi calibrado
// renderizando e medindo. O que acontece aqui é o que o legado não tem:
// cáusticas, feixes volumétricos, partículas, DOF, anti-aliasing e o
// diretor de câmera — todos ligados aos MESMOS parâmetros que já
// governam a cena, principalmente a hora solar.
//
// A regra que organiza o arquivo: nada de valor mágico solto. Toda
// constante de posição aqui é a mesma que a cena usa, e está anotada com
// onde ela vive no legado. Se a piscina se mover lá, o que quebra aqui é
// visível em uma linha, não espalhado por três shaders.
// ============================================================
import * as THREE from 'three';
import { agua } from '../effects/WaterShader';
import { volumetrica, type Abertura } from '../effects/VolumetricLight';
import { pos } from '../effects/PostProcessing';
import { ParticleSystem, criarPoeira, criarFumaca, criarPassaros } from '../effects/ParticleSystem';
import { diretor } from '../core/CameraDirector';

// ---- Geometria conhecida da cena, copiada do legado ----
// buildPoolAndDeck(): poolW/poolD/poolCx/poolCz/waterY
const PISCINA = { cx: -5.6, cz: 10.4, largura: 10.2, profundidade: 5.0, nivel: 0.02 };
// applyIndoorOcclusion(): as caixas de interior e o plano de vidro em z.
const SALA = { minX: -11.1, maxX: 12.1, piso: 0.06, teto: 3.30, vidroZ: 6.0 };

/** Aberturas por onde o sol entra. Normais apontando para fora da casa. */
const ABERTURAS: Abertura[] = [
  // Pano de vidro sul da sala: a abertura principal, dividida em três
  // fachos em vez de um só. Um facho de 23 m de largura lê como parede de
  // névoa; três separados leem como luz passando entre montantes, que é o
  // que acontece de verdade.
  { posicao: new THREE.Vector3(-6.0, 2.15, SALA.vidroZ), largura: 5.4, altura: 2.9, alcance: 11, normal: [0, 0, 1] },
  { posicao: new THREE.Vector3(1.2, 2.15, SALA.vidroZ), largura: 5.4, altura: 2.9, alcance: 11, normal: [0, 0, 1] },
  { posicao: new THREE.Vector3(8.4, 2.15, SALA.vidroZ), largura: 4.6, altura: 2.9, alcance: 10, normal: [0, 0, 1] },
  // Vão do pavimento superior, fachada oeste — é por onde o sol poente
  // entra de fato na hora dourada.
  { posicao: new THREE.Vector3(-13.1, 5.0, -0.2), largura: 0.6, altura: 2.4, alcance: 9, normal: [-1, 0, 0] },
];

type Nivel = 'ultra' | 'high' | 'medium' | 'low';

/**
 * O tier vem do legado como string livre. Um valor inesperado cai em
 * `medium`, e não em `ultra`: se não dá para saber o que o aparelho
 * aguenta, o palpite conservador é o único honesto.
 */
function nivelDeQualidade(v: string): Nivel {
  return v === 'ultra' || v === 'high' || v === 'medium' || v === 'low' ? v : 'medium';
}

interface CenaLegado {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: { enabled: boolean; target: THREE.Vector3 };
  composer: unknown;
  M: Record<string, THREE.Material>;
  // O legado é `@ts-nocheck`, então `level` chega como `string`. Estreitar
  // aqui, num ponto só, é melhor que espalhar `as` por todos os usos.
  Quality: { level: string };
  sunLight: THREE.DirectionalLight | null;
  solarTime: number;
}

export class CasaAuraScene {
  private particulas = new ParticleSystem();
  private cena: CenaLegado | null = null;
  private ultimaHoraSolar = -1;
  private direcaoSol = new THREE.Vector3(0, -1, 0);
  private montada = false;

  /**
   * Aplica todos os upgrades. Chamar UMA vez, depois de `init()` do
   * legado — antes disso `M`, `composer` e as luzes ainda não existem.
   */
  montar(cena: CenaLegado): void {
    if (this.montada) return;
    this.montada = true;
    this.cena = cena;

    this.montarAgua(cena);
    this.montarParticulas(cena);
    this.montarVolumetrica(cena);

    pos.aprimorar({
      composer: cena.composer as never,
      scene: cena.scene,
      camera: cena.camera,
      renderer: cena.renderer,
      nivel: nivelDeQualidade(cena.Quality.level),
    });

    diretor.ligar(cena.camera, cena.controls);
    diretor.aoFocar = (d, dur) => pos.puxarFoco(d, dur);

    console.info(
      `[cena] upgrades ativos — AA: ${pos.temAntiAliasing}, ` +
      `DOF: ${pos.temProfundidadeDeCampo ? 'sim' : 'não'}, ` +
      `feixes: ${volumetrica.ativo ? ABERTURAS.length : 0}`,
    );
  }

  // ------------------------------------------------------------
  private montarAgua(c: CenaLegado): void {
    // Cáustica é um laço de 3 iterações por pixel do casco. Nos tiers
    // baixos isso é caro para um efeito que só aparece de perto.
    if (c.Quality.level === 'low' || c.Quality.level === 'medium') return;
    agua.aplicar({
      materialAgua: c.M.agua ?? null,
      materialRevestimento: c.M.revestPiscina ?? null,
      centro: new THREE.Vector3(PISCINA.cx, PISCINA.nivel, PISCINA.cz),
      largura: PISCINA.largura,
      profundidade: PISCINA.profundidade,
      nivel: PISCINA.nivel,
    });
  }

  // ------------------------------------------------------------
  private montarParticulas(c: CenaLegado): void {
    // Densidade por tier. Em `low` fica zero, e zero significa que a
    // função devolve null e nenhum objeto entra na cena — não é um
    // objeto invisível ocupando chamada de desenho.
    const densidade =
      c.Quality.level === 'ultra' ? 1 :
      c.Quality.level === 'high' ? 0.6 :
      c.Quality.level === 'medium' ? 0.3 : 0;
    if (densidade === 0) return;

    // Poeira só dentro do volume da sala: é contra a luz da fachada sul
    // que ela aparece, e é lá que ela vale o custo.
    const caixa = new THREE.Box3(
      new THREE.Vector3(SALA.minX, SALA.piso + 0.3, -6.0),
      new THREE.Vector3(SALA.maxX, SALA.teto, SALA.vidroZ),
    );
    this.particulas.adicionar(criarPoeira(caixa, { densidade }));

    // Churrasqueira da área gourmet. A coordenada é a do `grillBody` em
    // buildPoolAndDeck (pergolaX + 1,5 = 2,7 / pergolaZ = 10,4), com a
    // origem 15 cm acima do tampo em 0,89. Na primeira versão eu chutei
    // (-12,2 / 2,4) e a fumaça saía de dentro da casa.
    this.particulas.adicionar(
      criarFumaca(new THREE.Vector3(2.7, 1.04, 10.4), { densidade }),
    );

    // Pássaros altos e longe: dão vida sem disputar atenção com a casa.
    this.particulas.adicionar(
      criarPassaros(new THREE.Vector3(0, 26, -10), { densidade }),
    );

    for (const o of this.particulas.objetos) c.scene.add(o);
  }

  // ------------------------------------------------------------
  private montarVolumetrica(c: CenaLegado): void {
    if (c.Quality.level === 'low') return;
    const dir = this.direcaoDoSol(c);
    volumetrica.construir(c.scene, ABERTURAS, dir);
    volumetrica.reapontar(dir);
  }

  private direcaoDoSol(c: CenaLegado): THREE.Vector3 {
    // A luz viaja DA posição do sol PARA a cena. `sunLight.position` é a
    // posição; a direção é o vetor dela até a origem, normalizado.
    if (!c.sunLight) return new THREE.Vector3(0, -1, 0);
    return c.sunLight.position.clone().negate().normalize();
  }

  /**
   * Um quadro. Recebe `dt` do laço do legado. Tudo que muda com o tempo
   * passa por aqui — não há segundo `requestAnimationFrame`.
   */
  quadro(dt: number, horaSolar: number): void {
    const c = this.cena;
    if (!c) return;

    diretor.atualizar(dt);
    pos.atualizar(dt);
    agua.atualizar(dt);
    volumetrica.atualizar(dt);
    this.particulas.atualizar(dt);

    // O que depende da hora solar só é recalculado quando ela muda de
    // fato. Durante a exploração livre ela fica parada, e recalcular
    // quaternion de quatro feixes a 60 Hz para nada é desperdício.
    if (Math.abs(horaSolar - this.ultimaHoraSolar) > 0.0015) {
      this.ultimaHoraSolar = horaSolar;
      const dir = this.direcaoDoSol(c);
      if (dir.dot(this.direcaoSol) < 0.9999) {
        this.direcaoSol.copy(dir);
        volumetrica.reapontar(dir);
      }
      volumetrica.aplicarHoraSolar(horaSolar);
      // Cáustica segue o sol: ela é luz refratada pela superfície, e
      // some quando o sol some. À noite quem acende a piscina são as
      // luzes submersas, que não fazem malha focada.
      agua.sol = Math.max(0, 1 - Math.max(0, (horaSolar - 0.62) / 0.28));
    }
  }

  /** DOF só nos estados em que a câmera está composta. */
  aoMudarEstado(estado: string): void {
    pos.profundidadeDeCampo = estado === 'CINEMATIC' || estado === 'PRESENTATION';
  }

  /**
   * Modo Leve. O QualityController prometia "sem pós-processamento, sem
   * partículas", mas só sabia desligar os passes: as partículas e os
   * feixes continuavam sendo desenhados. Era exatamente o tipo de botão
   * que existe e não faz nada. Agora faz.
   *
   * `visible = false` e não `destruir()`: se o aparelho engasgou num pico
   * e o usuário depois desliga o Modo Leve à mão, recriar geometria e
   * shader custaria mais um engasgo. Objeto invisível não é desenhado.
   */
  modoLeve(ligado: boolean): void {
    for (const o of this.particulas.objetos) o.visible = !ligado;
    volumetrica.suspenso = ligado;
  }

  redimensionar(largura: number, altura: number): void {
    pos.redimensionar(largura, altura);
  }

  destruir(): void {
    this.particulas.destruir();
    volumetrica.destruir();
    this.montada = false;
    this.cena = null;
  }
}

export const cenaAura = new CasaAuraScene();
