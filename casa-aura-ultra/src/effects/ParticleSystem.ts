// ============================================================
// PARTÍCULAS NA GPU
// ------------------------------------------------------------
// Três efeitos, um único par de buffers cada, e TODO o movimento no
// vertex shader. Nenhuma posição é atualizada em JavaScript: o que sobe
// para a GPU são atributos estáticos (semente, fase, escala) e o tempo
// como uniform. Mil partículas custam então o mesmo que uma no lado da
// CPU — que é a diferença entre isto rodar num iPad e não rodar.
//
// Os três, e por que cada um existe:
//
//   POEIRA   Sempre ativa, poucas partículas. É o efeito mais barato e o
//            que mais rende: ar visível é o que separa "render 3D" de
//            "fotografia de interior". Só aparece contra a luz.
//   FUMAÇA   Na churrasqueira da área gourmet. Diz que a casa é USADA.
//   PÁSSAROS No céu, em curva. Movimento longe da casa dá vida sem
//            competir com a arquitetura pela atenção.
// ============================================================
import * as THREE from 'three';
import POEIRA_VERT from '../shaders/poeira.vert?raw';
import POEIRA_FRAG from '../shaders/poeira.frag?raw';
import FUMACA_VERT from '../shaders/fumaca.vert?raw';
import FUMACA_FRAG from '../shaders/fumaca.frag?raw';
import PASSARO_VERT from '../shaders/passaro.vert?raw';
import PASSARO_FRAG from '../shaders/passaro.frag?raw';

export interface OpcoesParticulas {
  /** Reduzido nos tiers baixos; zero desliga o efeito. */
  densidade?: number;
}

// ---------------------------------------------------------------
// POEIRA
// ---------------------------------------------------------------

export function criarPoeira(
  caixa: THREE.Box3,
  opcoes: OpcoesParticulas = {},
): THREE.Points | null {
  const densidade = opcoes.densidade ?? 1;
  const n = Math.round(700 * densidade);
  if (n < 20) return null;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const sem = new Float32Array(n * 3);
  const tam = caixa.getSize(new THREE.Vector3());
  for (let i = 0; i < n; i++) {
    pos[i * 3 + 0] = caixa.min.x + Math.random() * tam.x;
    pos[i * 3 + 1] = caixa.min.y + Math.random() * tam.y;
    pos[i * 3 + 2] = caixa.min.z + Math.random() * tam.z;
    sem[i * 3 + 0] = Math.random();
    sem[i * 3 + 1] = 0.08 + Math.random() * 0.16;
    sem[i * 3 + 2] = 0.25 + Math.random() * 0.9;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('casaAura_semente', new THREE.BufferAttribute(sem, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      casaAura_tempo: { value: 0 },
      // 1,7 dava 51 px de disco a 1 m da câmera — a poeira lia como neve
      // dentro da sala. Ver a conta inteira em `poeira.vert`, que também
      // ganhou um teto de 6 px e um fade de perto. Com o teto fazendo o
      // trabalho pesado, este valor governa só a faixa média.
      casaAura_tamanho: { value: 0.9 },
      casaAura_cor: { value: new THREE.Color(0xfff2dc) },
      // Blending aditivo já acumula onde as partículas se sobrepõem;
      // 0,5 por partícula estourava para branco sólido nos aglomerados.
      casaAura_opacidade: { value: 0.22 },
    },
    vertexShader: POEIRA_VERT,
    fragmentShader: POEIRA_FRAG,
    transparent: true,
    depthWrite: false,          // poeira não oclui nada
    blending: THREE.AdditiveBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;    // a caixa cobre a cena; culling não ajuda
  pts.renderOrder = 3;
  pts.userData.tipo = 'poeira';
  return pts;
}

// ---------------------------------------------------------------
// FUMAÇA (churrasqueira)
// ---------------------------------------------------------------

export function criarFumaca(
  origem: THREE.Vector3,
  opcoes: OpcoesParticulas = {},
): THREE.Points | null {
  const densidade = opcoes.densidade ?? 1;
  const n = Math.round(70 * densidade);
  if (n < 10) return null;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const sem = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    pos[i * 3 + 0] = origem.x + (Math.random() - 0.5) * 0.22;
    pos[i * 3 + 1] = origem.y;
    pos[i * 3 + 2] = origem.z + (Math.random() - 0.5) * 0.22;
    sem[i * 2 + 0] = Math.random();
    sem[i * 2 + 1] = 0.6 + Math.random() * 0.7;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('casaAura_semente', new THREE.BufferAttribute(sem, 2));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      casaAura_tempo: { value: 0 },
      casaAura_altura: { value: 2.6 },
      // Cinza, não creme quase branco. Sob luz noturna o creme lia como
      // fonte de luz própria — a churrasqueira parecia estar pegando fogo.
      casaAura_cor: { value: new THREE.Color(0x9a958c) },
      // 0,24 por partícula, com dez delas empilhadas, dá 94% de cobertura:
      // opaco. 0,07 dá ~50%, que é o que deixa ver a pérgola ATRAVÉS da
      // fumaça — e é ver através que faz o olho aceitar como fumaça.
      casaAura_opacidade: { value: 0.07 },
    },
    vertexShader: FUMACA_VERT,
    fragmentShader: FUMACA_FRAG,
    transparent: true,
    depthWrite: false,
    // Fumaça é NormalBlending, não Additive: aditivo clareia o que está
    // atrás e fumaça cinza clareando o céu lê como fogo, não como fumaça.
    blending: THREE.NormalBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = 3;
  pts.userData.tipo = 'fumaca';
  return pts;
}

// ---------------------------------------------------------------
// PÁSSAROS
// ---------------------------------------------------------------
/**
 * Bando em V, seguindo uma curva fechada no céu. São malhas de 2
 * triângulos com asa que bate no vertex shader — mais barato que um
 * sistema de partículas e com silhueta reconhecível, que é o que importa
 * a 80 m de distância.
 */
export function criarPassaros(
  centro: THREE.Vector3,
  opcoes: OpcoesParticulas = {},
): THREE.Group | null {
  const densidade = opcoes.densidade ?? 1;
  const n = Math.round(9 * densidade);
  if (n < 3) return null;

  const g = new THREE.Group();
  g.userData.tipo = 'passaros';

  // Uma asa: dois triângulos espelhados, com a dobra no eixo do corpo.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, -0.5, 0, -0.28, -0.5, 0, 0.28,
    0, 0, 0, 0.5, 0, 0.28, 0.5, 0, -0.28,
  ]), 3));
  // `lado` diz ao shader qual asa é, para bater em oposição.
  geo.setAttribute('casaAura_lado', new THREE.BufferAttribute(
    new Float32Array([0, -1, -1, 0, 1, 1]), 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      casaAura_tempo: { value: 0 },
      casaAura_cor: { value: new THREE.Color(0x2b2b2e) },
    },
    vertexShader: PASSARO_VERT,
    fragmentShader: PASSARO_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Curva fechada e ampla, alta o bastante para nunca cruzar a casa.
  const curva = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-70, 26, -50),
    new THREE.Vector3(30, 32, -70),
    new THREE.Vector3(80, 28, 20),
    new THREE.Vector3(10, 34, 70),
    new THREE.Vector3(-60, 30, 40),
  ], true, 'catmullrom', 0.5);
  g.userData.curva = curva;

  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.setScalar(1.3 + Math.random() * 0.7);
    // Formação em V: o deslocamento lateral cresce com a distância do
    // líder, e o atraso ao longo da curva também.
    const fila = Math.ceil(i / 2);
    const lado = i % 2 === 0 ? 1 : -1;
    m.userData.atraso = fila * 0.012;
    m.userData.lateral = lado * fila * 1.6;
    g.add(m);
  }
  g.position.copy(centro).setY(0);
  return g;
}

// ---------------------------------------------------------------
// GERENCIADOR
// ---------------------------------------------------------------
export class ParticleSystem {
  private grupos: THREE.Object3D[] = [];
  private tempo = 0;
  private passaros: THREE.Group | null = null;

  adicionar(o: THREE.Object3D | null): void {
    if (o) this.grupos.push(o);
    if (o && o.userData.tipo === 'passaros') this.passaros = o as THREE.Group;
  }

  /** Os objetos criados, para quem monta a cena adicioná-los. */
  get objetos(): readonly THREE.Object3D[] {
    return this.grupos;
  }

  /** Chamar por quadro com o delta em segundos. */
  atualizar(dt: number): void {
    this.tempo += dt;
    for (const o of this.grupos) {
      const m = (o as THREE.Points).material as THREE.ShaderMaterial | undefined;
      if (m?.uniforms?.casaAura_tempo) m.uniforms.casaAura_tempo.value = this.tempo;
    }
    if (!this.passaros) return;
    // Os pássaros são o único caso com trabalho de CPU, e é trivial: 9
    // objetos andando por uma curva. Colocá-los no shader exigiria a curva
    // como textura, e não vale por nove objetos.
    const curva = this.passaros.userData.curva as THREE.CatmullRomCurve3;
    const mat = this.passaros.children[0]
      ? ((this.passaros.children[0] as THREE.Mesh).material as THREE.ShaderMaterial)
      : null;
    if (mat?.uniforms?.casaAura_tempo) mat.uniforms.casaAura_tempo.value = this.tempo;

    const base = (this.tempo * 0.006) % 1;
    const p = new THREE.Vector3();
    const alvo = new THREE.Vector3();
    for (const c of this.passaros.children) {
      const t = (base - (c.userData.atraso as number) + 1) % 1;
      curva.getPointAt(t, p);
      curva.getPointAt((t + 0.01) % 1, alvo);
      c.position.copy(p);
      // desloca lateralmente no plano horizontal, para formar o V
      const dir = alvo.clone().sub(p).setY(0).normalize();
      const lat = new THREE.Vector3(-dir.z, 0, dir.x);
      c.position.addScaledVector(lat, c.userData.lateral as number);
      c.lookAt(alvo);
    }
  }

  /** Regra de ouro nº 2: nada sai de cena sem dispose. */
  destruir(): void {
    for (const o of this.grupos) {
      o.parent?.remove(o);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((i) => i.dispose());
        else mat?.dispose();
      });
    }
    this.grupos = [];
    this.passaros = null;
  }
}
