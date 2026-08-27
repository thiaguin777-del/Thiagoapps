// ============================================================
// DIREÇÃO DE CÂMERA — planos em trilho
// ------------------------------------------------------------
// A navegação livre continua no OrbitControls da cena, e a troca de
// capítulo continua na `goToChapter` herdada, que já sabe uma coisa que
// este módulo não sabe: o envelope da casa. Ela testa se a trajetória
// cruzaria o edifício e, se cruzar, corta com fade em vez de atravessar
// parede. Isso foi conquistado depurando e não se joga fora.
//
// O que este módulo faz é o que falta para CINEMATIC e PRESENTATION: um
// diretor de fotografia. Três diferenças em relação ao voo herdado:
//
// 1. ORIENTAÇÃO POR QUATERNION.SLERP
//    O voo herdado interpola a POSIÇÃO na curva e o ALVO do orbit por
//    lerp linear, e deixa o `lookAt` derivar disso. Quando o plano novo
//    olha para trás, o alvo interpolado passa POR CIMA da câmera: a
//    imagem chicoteia e depois se assenta. Slerp entre a orientação
//    inicial e a final pega o caminho angular mais curto, sempre, e é o
//    que dá a sensação de cabeça de tripé sendo girada por uma pessoa.
//
// 2. VELOCIDADE COM ENTRADA E SAÍDA
//    Movimento de câmera profissional nunca começa nem termina de
//    supetão. Cada plano tem sua própria rampa.
//
// 3. DOLLY ZOOM
//    A câmera avança enquanto o campo de visão fecha, mantendo o assunto
//    do mesmo tamanho e fazendo o FUNDO colapsar para dentro. É o efeito
//    que mostra a profundidade de um ambiente melhor do que qualquer
//    outro recurso, e num pé-direito duplo ele é espetacular.
//    Matematicamente: manter `2·tan(fov/2)·distância` constante.
// ============================================================
import * as THREE from 'three';

export interface Plano {
  /** Posição final da câmera, em metros. */
  posicao: [number, number, number];
  /** Ponto para onde o plano olha. */
  alvo: [number, number, number];
  /** Duração do movimento, em segundos. */
  duracao: number;
  /** Pontos de passagem intermediários, para desenhar um arco. */
  passagem?: [number, number, number][];
  /**
   * Se verdadeiro, a câmera persegue o alvo durante todo o percurso em
   * vez de apenas chegar orientada nele. Use em plano que segue um
   * assunto; deixe falso em movimento de revelação, onde o interesse é
   * justamente o que entra em quadro no caminho.
   */
  mirarSempre?: boolean;
  /** Distância de foco ao chegar. Aciona rack focus se diferente. */
  foco?: number;
  /** Campo de visão final. Junto com o avanço, produz o dolly zoom. */
  fovFinal?: number;
  /** Espera parado ao fim do movimento, em segundos. */
  pausa?: number;
  legenda?: string;
}

type AoTrocarPlano = (indice: number, plano: Plano) => void;

const _dummy = new THREE.Object3D();
const _v = new THREE.Vector3();

export class CameraDirector {
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: { enabled: boolean; target: THREE.Vector3 } | null = null;

  private planos: Plano[] = [];
  private indice = -1;
  private curva: THREE.CatmullRomCurve3 | null = null;
  private quatInicio = new THREE.Quaternion();
  private quatFim = new THREE.Quaternion();
  private alvoAtual = new THREE.Vector3();
  private fovInicio = 45;
  private fovFim = 45;
  private distInicio = 10;
  private decorrido = 0;
  private duracao = 0;
  private esperando = 0;
  private rodando = false;

  /** Chamado a cada plano novo — a legenda da apresentação escuta isto. */
  aoTrocarPlano: AoTrocarPlano | null = null;
  /** Chamado quando a sequência termina. */
  aoTerminar: (() => void) | null = null;
  /** Ligado ao rack focus do pós-processamento. */
  aoFocar: ((distancia: number, duracao: number) => void) | null = null;

  ligar(
    camera: THREE.PerspectiveCamera,
    controls: { enabled: boolean; target: THREE.Vector3 },
  ): void {
    this.camera = camera;
    this.controls = controls;
  }

  get ativo(): boolean {
    return this.rodando;
  }

  /**
   * Assume a câmera e reproduz a sequência. Desliga o OrbitControls
   * enquanto dura: dois donos do mesmo transform brigam a cada quadro e o
   * resultado é tremor.
   */
  reproduzir(planos: Plano[]): void {
    if (!this.camera || planos.length === 0) return;
    this.planos = planos;
    this.indice = -1;
    this.rodando = true;
    if (this.controls) this.controls.enabled = false;
    // `enabled = false` NAO basta: o laco do legado chama
    // `controls.update()` todo quadro, e esse metodo ignora `enabled` e
    // termina com `object.lookAt(target)`. Sem esta trava o slerp de
    // orientacao — o recurso principal deste modulo — era sobrescrito a
    // cada quadro e simplesmente nao existia na tela.
    (window as unknown as { __auraCameraTravada?: boolean }).__auraCameraTravada = true;
    this.proximo();
  }

  /**
   * Devolve a câmera ao usuário. O alvo do orbit é reposicionado à frente
   * da câmera antes de religar os controles — sem isso o primeiro arrasto
   * gira em torno de um ponto herdado do último plano, e a navegação
   * parece quebrada.
   */
  parar(): void {
    if (!this.rodando) return;
    this.rodando = false;
    this.curva = null;
    (window as unknown as { __auraCameraTravada?: boolean }).__auraCameraTravada = false;
    if (this.camera && this.controls) {
      this.camera.getWorldDirection(_v);
      this.controls.target.copy(this.camera.position).addScaledVector(_v, 6);
      this.controls.enabled = true;
    }
  }

  private proximo(): void {
    this.indice++;
    if (this.indice >= this.planos.length) {
      this.parar();
      this.aoTerminar?.();
      return;
    }
    const cam = this.camera!;
    const p = this.planos[this.indice];

    const inicio = cam.position.clone();
    const fim = new THREE.Vector3(...p.posicao);
    this.alvoAtual.set(...p.alvo);

    // Curva de posição. Com dois pontos apenas, a Catmull-Rom degenera em
    // reta — o que é correto para um plano direto. Pontos de passagem
    // desenham o arco.
    const pts = [inicio];
    if (p.passagem) for (const q of p.passagem) pts.push(new THREE.Vector3(...q));
    pts.push(fim);
    this.curva = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);

    // Orientação: guarda a atual e calcula a final com um objeto de
    // apoio. `_dummy.up` herda o padrão Y+, que é o que mantém o horizonte
    // nivelado — câmera de arquitetura não tem dutch angle.
    this.quatInicio.copy(cam.quaternion);
    _dummy.position.copy(fim);
    _dummy.lookAt(this.alvoAtual);
    this.quatFim.copy(_dummy.quaternion);

    // Dolly zoom: guarda a distância inicial ao assunto para manter o
    // produto tan(fov/2)·distância constante durante o percurso.
    this.fovInicio = cam.fov;
    this.fovFim = p.fovFinal ?? cam.fov;
    this.distInicio = Math.max(0.5, inicio.distanceTo(this.alvoAtual));

    this.decorrido = 0;
    this.duracao = Math.max(0.05, p.duracao);
    this.esperando = 0;

    if (p.foco !== undefined) this.aoFocar?.(p.foco, Math.min(p.duracao, 1.6));
    this.aoTrocarPlano?.(this.indice, p);
  }

  atualizar(dt: number): void {
    if (!this.rodando || !this.camera || !this.curva) return;
    const cam = this.camera;

    if (this.esperando > 0) {
      this.esperando -= dt;
      if (this.esperando <= 0) this.proximo();
      return;
    }

    this.decorrido = Math.min(this.duracao, this.decorrido + dt);
    const t = this.decorrido / this.duracao;
    // Ease in-out cúbico: rampa de partida e de chegada simétricas.
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    cam.position.copy(this.curva.getPointAt(e));

    const p = this.planos[this.indice];
    if (p.mirarSempre) {
      // Persegue o alvo, mas ainda com amortecimento angular: aplicar
      // lookAt cru a cada quadro cola a câmera no assunto de um jeito
      // mecânico que denuncia automação.
      _dummy.position.copy(cam.position);
      _dummy.lookAt(this.alvoAtual);
      cam.quaternion.slerp(_dummy.quaternion, Math.min(1, dt * 4.5));
    } else {
      cam.quaternion.slerpQuaternions(this.quatInicio, this.quatFim, e);
    }

    // ---- DOLLY ZOOM ----
    // Só quando o plano pediu um fov final diferente. O fov percorre a
    // rampa e a POSIÇÃO já está na curva; para o assunto não mudar de
    // tamanho, quem tem de compensar é a distância. Como a curva é fixa,
    // aqui o fov é derivado da distância real do quadro — assim o efeito
    // funciona mesmo com pontos de passagem.
    if (this.fovFim !== this.fovInicio) {
      const distAtual = Math.max(0.5, cam.position.distanceTo(this.alvoAtual));
      // Enquadramento que se quer preservar, interpolado entre o inicial
      // e o pedido: em e=0 preserva o de partida, em e=1 entrega o fov
      // pedido exatamente.
      const alturaInicio = 2 * Math.tan(THREE.MathUtils.degToRad(this.fovInicio) / 2) * this.distInicio;
      const fovDerivado = 2 * THREE.MathUtils.radToDeg(Math.atan(alturaInicio / (2 * distAtual)));
      const fov = THREE.MathUtils.lerp(fovDerivado, this.fovFim, e);
      cam.fov = THREE.MathUtils.clamp(fov, 12, 90);
      cam.updateProjectionMatrix();
    }

    if (this.controls) this.controls.target.copy(this.alvoAtual);

    if (t >= 1) {
      if (p.pausa && p.pausa > 0) this.esperando = p.pausa;
      else this.proximo();
    }
  }

  /**
   * Distância da câmera até o assunto do plano atual. É o valor que o
   * rack focus quer quando o plano não define `foco` à mão.
   */
  get distanciaAoAlvo(): number {
    if (!this.camera) return 10;
    return this.camera.position.distanceTo(this.alvoAtual);
  }
}

export const diretor = new CameraDirector();
