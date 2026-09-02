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
  /** Campo de visão final. Uma troca de distância focal, simples. */
  fovFinal?: number;
  /**
   * DOLLY ZOOM DE VERDADE: mantém `2·tan(fov/2)·distância` constante do
   * começo ao fim, ou seja, o assunto NÃO muda de tamanho e é o fundo
   * que colapsa. `fovFinal` não faz isso — ele só troca a lente, e com
   * `fovFinal` igual ao fov base (38°) não fazia nem isso: a condição
   * `fovFim !== fovInicio` era falsa e o efeito inteiro ficava morto.
   */
  dollyZoom?: boolean;
  /**
   * DE ONDE O PLANO COMEÇA. Sem isto o movimento partia de onde quer que
   * o cliente tivesse deixado a câmera — e com `maxDistance = 46` mais
   * pan livre, isso pode ser a 46 m olhando para o morro. Era a causa de
   * a apresentação abrir mostrando paisagem: os primeiros seis dos sete
   * segundos do plano de abertura eram a viagem de volta.
   *
   * Com `partida`, o plano CORTA (atrás de um fade) para uma pose
   * composta e só então se move. É como um filme abre de verdade.
   */
  partida?: [number, number, number];
  /** Espera parado ao fim do movimento, em segundos. */
  pausa?: number;
  legenda?: string;
}

type AoTrocarPlano = (indice: number, plano: Plano) => void;

/**
 * SUPORTE DE ORIENTAÇÃO — e ele PRECISA ser uma Camera, não um Object3D.
 *
 * BUG ENCONTRADO, e é a causa raiz do defeito que o cliente relatou como
 * "o Modo Apresentação mostra a paisagem em vez da casa".
 *
 * `Object3D.lookAt()` e `Camera.lookAt()` produzem quaternions OPOSTOS,
 * de propósito: um objeto comum aponta o +Z dele para o alvo (é o que
 * faz sentido para uma seta, um cartão, um holofote); uma câmera olha
 * pelo -Z. O próprio Three.js troca os argumentos de `Matrix4.lookAt`
 * conforme `this.isCamera`.
 *
 * Copiar o quaternion de um `Object3D` orientado para uma câmera põe a
 * câmera olhando EXATAMENTE para o lado contrário do assunto.
 *
 * MEDIDO, com a pose real do plano "Chegada" (olho 18/7,5/16, alvo
 * -1/4,2/0):
 *
 *   direção correta câmera->alvo ......... [-0,758, -0,132, -0,639]
 *   Object3D.lookAt -> frente ............ [ 0,758,  0,132,  0,639]
 *   erro angular ......................... 180,00 graus
 *   PerspectiveCamera.lookAt -> erro ..... 0,00 grau
 *
 * Por que o sintoma era intermitente e não uma tela sempre errada: em
 * cada plano a orientação faz slerp de `quatInicio` (a orientação REAL
 * da câmera naquele instante, que está certa) até `quatFim` (calculado
 * pelo suporte, 180 graus errado). O plano COMEÇA enquadrado e vai
 * girando até terminar de costas para a casa — mostrando o céu e o
 * relevo de fundo. É exatamente o relato.
 *
 * `THREE.Camera` é a correção mínima: ela tem `isCamera = true`, então
 * `lookAt` toma o ramo certo. Não é um Object3D com um comentário
 * pedindo cuidado — é o tipo que já carrega a semântica.
 */
const _dummy = new THREE.Camera();
const _v = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _eixoY = new THREE.Vector3(0, 1, 0);

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
  /** Enquanto o fade do corte roda, a câmera não é tocada. */
  private emCorte = false;
  /**
   * O corte pendente, se houver. UM fade por vez, e o último pedido
   * vence.
   *
   * A primeira versão usava uma ficha para invalidar o callback velho —
   * o que protegia a escrita na câmera, mas não o VÉU. `doFadeCut` do
   * legado agenda a remoção do fade 60 ms depois da própria aplicação, e
   * faz isso incondicionalmente. Dois cortes sobrepostos (dois cliques em
   * "próximo" dentro de 300 ms, ou sair e reentrar) davam: fade do corte
   * A abre em t≈360 ms mostrando a pose ANTIGA, e a pose nova entra de
   * supetão em t≈400 ms. Exatamente o teleporte que o fade existe para
   * esconder.
   *
   * Agora, se um fade já está cobrindo a tela, o pedido novo só substitui
   * o conteúdo pendente e nenhum segundo fade é agendado. O callback que
   * já existe aplica o mais recente.
   */
  private corteEmEspera: (() => void) | null = null;
  /** Fov do usuário no momento de assumir a câmera, para devolver igual. */
  private fovDoUsuario = 0;
  private mantemEnquadramento = false;
  private alturaAlvo = 0;

  /** Chamado a cada plano novo — a legenda da apresentação escuta isto. */
  aoTrocarPlano: AoTrocarPlano | null = null;
  /** Chamado quando a sequência termina. */
  aoTerminar: (() => void) | null = null;
  /** Ligado ao rack focus do pós-processamento. */
  aoFocar: ((distancia: number, duracao: number) => void) | null = null;
  /**
   * Corte atrás de um fade. É `doFadeCut` do legado — o diretor não
   * reimplementa o fade, consome o que já existe e já foi calibrado.
   */
  cortar: ((aplicar: () => void) => void) | null = null;
  /**
   * `transitionNeedsCut` do legado: sabe que a trajetória cruzaria o
   * edifício. Sem isto o Modo Apresentação voava através da fachada.
   */
  precisaCortar: ((de: THREE.Vector3, para: THREE.Vector3) => boolean) | null = null;
  /** `pointInEnvelope` do legado: separa plano interno de plano externo. */
  dentroDaCasa: ((p: THREE.Vector3, folga?: number) => boolean) | null = null;

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
   * Estado interno, para inspeção. Existe por uma razão concreta: o
   * ambiente de desenvolvimento não tem GPU e roda a ~0,1 quadro por
   * segundo, e `animate()` limita `dt` a 0,1 s por quadro. Um plano de
   * sete segundos precisaria de setenta quadros, ou seja onze MINUTOS de
   * relógio — qualquer teste da trajetória feito esperando o filme rodar
   * mede o relógio, não o diretor.
   *
   * Com `atualizar(dt)` público e este estado legível, um teste percorre
   * o filme inteiro em milissegundos, sem desenhar nada, e mede o erro de
   * mira e o enquadramento em cada ponto do percurso.
   */
  get estado(): {
    indice: number; rodando: boolean; emCorte: boolean;
    decorrido: number; duracao: number; esperando: number;
  } {
    return {
      indice: this.indice, rodando: this.rodando, emCorte: this.emCorte,
      decorrido: +this.decorrido.toFixed(3), duracao: this.duracao,
      esperando: +this.esperando.toFixed(3),
    };
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
    // O fov é do USUÁRIO, não do filme. Um plano com dolly zoom o deixa
    // em 52° ou 28°, e sem guardar aqui a exploração livre continuava
    // depois com a lente errada para sempre — inclusive nas fotos que o
    // corretor tira da tela.
    if (!this.rodando) this.fovDoUsuario = this.camera.fov;
    // Descarta corte pendente de uma reprodução anterior.
    this.corteEmEspera = null;
    this.emCorte = false;
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
    this.emCorte = false;
    this.corteEmEspera = null;
    this.curva = null;
    (window as unknown as { __auraCameraTravada?: boolean }).__auraCameraTravada = false;
    if (this.camera && this.fovDoUsuario > 0 && this.camera.fov !== this.fovDoUsuario) {
      this.camera.fov = this.fovDoUsuario;
      this.camera.updateProjectionMatrix();
    }
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
    this.abrirPlano(this.planos[this.indice]);
  }

  // ------------------------------------------------------------
  /**
   * ONDE O PLANO COMEÇA — e é aqui que morava o defeito de a
   * apresentação abrir mostrando paisagem.
   *
   * Antes, todo plano partia da posição atual da câmera, fosse ela qual
   * fosse. Como o OrbitControls permite pan livre e `maxDistance = 46`,
   * "onde o cliente deixou a câmera" pode ser 46 m de distância olhando
   * para o morro do fundo — e o plano de abertura gastava seis dos seus
   * sete segundos voltando de lá. Pior: a reta de volta atravessava a
   * casa, porque o diretor não conhecia o envelope.
   *
   * Três regras, nesta ordem:
   *
   *  1. Se o plano declara `partida`, é ela. Corte atrás de fade.
   *  2. Se não declara mas a trajetória cruzaria o edifício
   *     (`transitionNeedsCut`, do legado), o plano não pode voar: corta
   *     para um ponto DERIVADO DA PRÓPRIA COMPOSIÇÃO — recuado no eixo
   *     câmera→assunto e girado um pouco em torno de Y. Assim o primeiro
   *     quadro já enquadra a casa e o movimento vira uma aproximação em
   *     arco, que é como se abre um plano de arquitetura.
   *  3. Caso contrário, voa de onde está.
   *
   * A regra 2 respeita o lado da parede: um ponto de partida derivado só
   * é aceito se estiver do MESMO lado do envelope que a posição final —
   * senão o "arco" seria uma travessia de fachada com outro nome.
   */
  private partidaDe(p: Plano, fim: THREE.Vector3, alvo: THREE.Vector3): THREE.Vector3 | null {
    const cam = this.camera!;
    if (p.partida) {
      const q = new THREE.Vector3(...p.partida);
      return cam.position.distanceTo(q) < 0.05 ? null : q;
    }
    if (!this.precisaCortar || !this.precisaCortar(cam.position, fim)) return null;

    const dentro = this.dentroDaCasa;
    const fimDentro = dentro ? dentro(fim, 0) : false;
    const eixo = _vB.copy(fim).sub(alvo);
    const dist = eixo.length();
    if (dist < 0.2) return fim.clone();

    // Tenta um recuo em arco; se cair do outro lado da parede, encolhe
    // até caber. Zero recuo significa "corta direto para o plano" — ainda
    // correto, só sem movimento de entrada.
    for (const [ganho, giro] of [[1.30, 0.28], [1.16, 0.18], [1.07, 0.10], [1.0, 0.0]]) {
      const c = _vC.copy(eixo).multiplyScalar(ganho);
      if (giro > 0) c.applyAxisAngle(_eixoY, giro);
      const cand = new THREE.Vector3().copy(alvo).add(c);
      if (cand.y < 0.6) cand.y = 0.6;
      if (!dentro || dentro(cand, 0) === fimDentro) return cand;
    }
    return fim.clone();
  }

  private abrirPlano(p: Plano): void {
    const cam = this.camera!;
    const fim = new THREE.Vector3(...p.posicao);
    const alvo = new THREE.Vector3(...p.alvo);
    const partida = this.partidaDe(p, fim, alvo);

    if (!partida) { this.montarMovimento(p, fim, alvo); return; }

    // CORTE. Enquanto o fade cobre a tela a câmera é reposicionada e
    // JÁ ORIENTADA no assunto: o primeiro quadro depois do fade é uma
    // composição, nunca uma paisagem.
    // O que este corte quer fazer quando o véu estiver cobrindo a tela.
    this.corteEmEspera = (): void => {
      cam.position.copy(partida);
      _dummy.position.copy(partida);
      _dummy.lookAt(alvo);
      cam.quaternion.copy(_dummy.quaternion);
      if (this.controls) this.controls.target.copy(alvo);
      this.montarMovimento(p, fim, alvo);
    };

    // Já há um fade cobrindo a tela: o callback dele vai pegar este
    // conteúdo. Agendar um segundo fade é o que produzia o teleporte.
    if (this.emCorte) return;

    this.emCorte = true;
    const aplicar = (): void => {
      const fazer = this.corteEmEspera;
      this.corteEmEspera = null;
      this.emCorte = false;
      // A apresentação pode ter terminado durante os 300 ms do fade.
      if (fazer && this.rodando) fazer();
    };
    if (this.cortar) this.cortar(aplicar); else aplicar();
  }

  private montarMovimento(p: Plano, fim: THREE.Vector3, alvo: THREE.Vector3): void {
    const cam = this.camera!;
    const inicio = cam.position.clone();
    this.alvoAtual.copy(alvo);

    // Curva de posição. Com dois pontos apenas, a Catmull-Rom degenera em
    // reta — o que é correto para um plano direto. Pontos de passagem
    // desenham o arco.
    const pts = [inicio];
    if (p.passagem) for (const q of p.passagem) pts.push(new THREE.Vector3(...q));
    pts.push(fim);
    // Dois pontos coincidentes fazem a Catmull-Rom devolver NaN em
    // `getPointAt` — e câmera em NaN renderiza tela preta sem erro
    // nenhum, que é o pior modo de falhar que existe.
    const limpos = pts.filter((q, i) => i === 0 || q.distanceToSquared(pts[i - 1]) > 1e-8);
    this.curva = new THREE.CatmullRomCurve3(
      limpos.length >= 2 ? limpos : [inicio, fim.clone().addScaledVector(_eixoY, 0.001)],
      false, 'catmullrom', 0.5,
    );

    // Orientação: guarda a atual e calcula a final com um objeto de
    // apoio. `_dummy.up` herda o padrão Y+, que é o que mantém o horizonte
    // nivelado — câmera de arquitetura não tem dutch angle.
    this.quatInicio.copy(cam.quaternion);
    _dummy.position.copy(fim);
    _dummy.lookAt(this.alvoAtual);
    this.quatFim.copy(_dummy.quaternion);

    // ------------------------------------------------------------
    // A LENTE VOLTA AO PADRÃO A CADA PLANO
    //
    // DEFEITO MEDIDO percorrendo o filme: o plano "O estar" pede dolly
    // zoom e termina com a lente em 54,67° — que é o efeito funcionando,
    // a câmera se aproxima e o campo abre para segurar o enquadramento.
    // Só que o plano seguinte fazia `fovFim = p.fovFinal ?? cam.fov`, ou
    // seja herdava 54,67°, e a condição `fovFim !== fovInicio` passava a
    // ser falsa: os SEIS planos restantes do filme rodavam em 54,67° em
    // vez dos 40° compostos. Grande-angular em tudo, com a distorção que
    // vem junto, por herança de um plano anterior.
    //
    // Cada plano é um CORTE. Corte troca de lente. A lente volta ao valor
    // que o cliente tinha antes do filme, a não ser que este plano seja
    // justamente o que quer preservar o enquadramento de onde veio.
    // ------------------------------------------------------------
    if (!p.dollyZoom && this.fovDoUsuario > 0 && cam.fov !== this.fovDoUsuario) {
      cam.fov = this.fovDoUsuario;
      cam.updateProjectionMatrix();
    }

    // Dolly zoom: guarda a distância inicial ao assunto para manter o
    // produto tan(fov/2)·distância constante durante o percurso.
    this.fovInicio = cam.fov;
    this.fovFim = p.fovFinal ?? cam.fov;
    this.mantemEnquadramento = p.dollyZoom === true;
    this.distInicio = Math.max(0.5, inicio.distanceTo(this.alvoAtual));
    this.alturaAlvo = 2 * Math.tan(THREE.MathUtils.degToRad(this.fovInicio) / 2) * this.distInicio;

    this.decorrido = 0;
    this.duracao = Math.max(0.05, p.duracao);
    this.esperando = 0;

    if (p.foco !== undefined) this.aoFocar?.(p.foco, Math.min(p.duracao, 1.6));
    this.aoTrocarPlano?.(this.indice, p);
  }

  atualizar(dt: number): void {
    // Durante o fade do corte a câmera JÁ está na pose nova e o
    // movimento ainda não começou: mexer nela aqui produziria um pulo
    // exatamente no quadro em que o fade abre.
    if (this.emCorte) return;
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
    if (this.mantemEnquadramento || this.fovFim !== this.fovInicio) {
      const distAtual = Math.max(0.5, cam.position.distanceTo(this.alvoAtual));
      // `fovDerivado` é o campo de visão que mantém o assunto EXATAMENTE
      // do mesmo tamanho na tela a esta distância. É a definição do
      // dolly zoom: o assunto não muda, o fundo colapsa.
      const fovDerivado = 2 * THREE.MathUtils.radToDeg(Math.atan(this.alturaAlvo / (2 * distAtual)));
      // `dollyZoom` puro: nada de lerp, senão o assunto respira e o
      // efeito vira um zoom comum. Com `fovFinal`, a rampa vai do
      // enquadramento preservado até a lente pedida.
      const fov = this.mantemEnquadramento
        ? fovDerivado
        : THREE.MathUtils.lerp(fovDerivado, this.fovFim, e);
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
