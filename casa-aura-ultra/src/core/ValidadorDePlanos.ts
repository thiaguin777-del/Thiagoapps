// ============================================================
// VALIDADOR DE PLANOS — a casa tem de estar no quadro
// ------------------------------------------------------------
// O cliente relatou que entrar no Modo Apresentação podia mostrar
// PAISAGEM em vez da casa. As causas estruturais foram corrigidas no
// CameraDirector (partida determinística e corte quando a trajetória
// cruza o edifício), mas corrigir a mecânica não prova que os oito
// enquadramentos do roteiro estão certos: um plano pode ter coordenadas
// perfeitamente válidas e ainda assim apontar para o vazio.
//
// Este módulo mede cada plano contra a GEOMETRIA REAL da cena. Não é um
// teste de unidade sobre números inventados: ele lança raios contra as
// malhas da casa que estão na tela naquele momento.
//
// Por plano, e nas DUAS poses (partida e chegada, porque um plano que
// chega bem e começa olhando para o morro ainda é um plano ruim):
//
//   cobertura   fração de uma grade de raios que atinge a casa. É a
//               medida honesta de "quanto deste quadro é casa".
//   centro      o raio do centro do quadro atinge a casa? A que
//               distância? Um plano de arquitetura sem assunto no centro
//               não é um plano, é um panorama.
//   dentro      a câmera está dentro do envelope construído? Serve para
//               conferir que partida e chegada estão do MESMO lado da
//               parede — se não estiverem, o movimento atravessa fachada.
//   solido      a câmera está dentro da caixa de alguma malha? É o
//               defeito que produz "tela cheia de textura sem sentido".
//
// Roda só com `?validar=1`. Em produção o custo é zero: o módulo é
// importado dinamicamente e nem chega a ser baixado.
// ============================================================
import * as THREE from 'three';

export interface PoseDePlano {
  posicao: [number, number, number];
  alvo: [number, number, number];
  partida?: [number, number, number];
  titulo?: string;
}

export interface LaudoDePose {
  onde: 'partida' | 'chegada';
  pos: [number, number, number];
  /** Fração da grade de raios que encontrou a casa, 0..1. */
  cobertura: number;
  /** O raio central acertou a casa? */
  centroNaCasa: boolean;
  /** Distância do acerto central, em metros; null se não acertou. */
  distanciaCentro: number | null;
  /** Câmera dentro do envelope da casa. */
  dentroDoEnvelope: boolean;
  /** Nomes das malhas cuja caixa contém a câmera. Vazio é o esperado. */
  dentroDeSolido: string[];
}

export interface LaudoDePlano {
  indice: number;
  titulo: string;
  poses: LaudoDePose[];
  /** Partida e chegada em lados opostos da parede: o voo atravessa fachada. */
  atravessaFachada: boolean;
  problemas: string[];
}

/**
 * Grade de amostragem do quadro. 5×5 = 25 raios por pose.
 *
 * A primeira versão usava 9×9. Não era mais precisa — era inviável: 81
 * raios × 2 poses × 8 planos = 1296 lançamentos contra malhas FUNDIDAS,
 * sem nenhuma estrutura de aceleração, na thread principal. Bloqueava o
 * boot por minutos. 25 raios já distinguem "a casa domina o quadro" de
 * "a casa não está no quadro", que é a pergunta.
 */
const GRADE = 5;
/**
 * Piso de cobertura. Um plano de arquitetura pode ser legitimamente
 * aberto — a "Chegada" tem céu e jardim de sobra — mas abaixo de 8% do
 * quadro a casa deixou de ser o assunto.
 */
const COBERTURA_MINIMA = 0.08;

const _dummy = new THREE.Object3D();

/**
 * O QUE CONTA COMO "A CASA".
 *
 * `houseGroup` não é só o edifício: `buildGround()` pendura nele o
 * gramado de 130 m, o campo de fundo de 900 m com 18 mil triângulos e os
 * canteiros. Se tudo isso contasse, um plano apontado para o jardim
 * mediria 100% de "casa" — o defeito que este módulo existe para pegar
 * passaria batido — e cada raio ainda teria de atravessar o terreno
 * inteiro, que é o que travava o boot na primeira versão deste arquivo.
 *
 * Casa é o que cabe DENTRO do envelope construído, com folga de 2 m para
 * beirais e brises. É o mesmo envelope que a navegação já usa.
 */
export function malhasDeEdificio(
  raiz: THREE.Object3D,
  dentroDoEnvelope: (p: THREE.Vector3, folga?: number) => boolean,
): THREE.Mesh[] {
  const centro = new THREE.Vector3();
  const tamanho = new THREE.Vector3();
  const caixa = new THREE.Box3();
  const out: THREE.Mesh[] = [];
  raiz.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !o.visible) return;
    caixa.setFromObject(m, true);
    if (!isFinite(caixa.min.x)) return;
    caixa.getCenter(centro);
    caixa.getSize(tamanho);
    if (tamanho.x > 40 || tamanho.z > 40 || !dentroDoEnvelope(centro, 2.0)) return;
    out.push(m);
  });
  return out;
}

/**
 * Enquadramento da câmera COMO ELA ESTÁ AGORA. É a mesma medida que
 * `validarPlanos` faz por pose, só que sobre a câmera viva — o que
 * permite auditar o Modo Apresentação enquanto ele roda de verdade, pelo
 * botão, em vez de sobre coordenadas lidas de um arquivo.
 */
export function medirEnquadramento(
  cam: THREE.PerspectiveCamera,
  alvos: THREE.Mesh[],
): { cobertura: number; centroNaCasa: boolean; distanciaCentro: number | null } {
  const raio = new THREE.Raycaster();
  raio.far = 400;
  const ndc = new THREE.Vector2();
  cam.updateMatrixWorld(true);
  let acertos = 0;
  for (let gy = 0; gy < GRADE; gy++) {
    for (let gx = 0; gx < GRADE; gx++) {
      ndc.set((gx + 0.5) / GRADE * 2 - 1, (gy + 0.5) / GRADE * 2 - 1);
      raio.setFromCamera(ndc, cam);
      if (raio.intersectObjects(alvos, false).length > 0) acertos++;
    }
  }
  ndc.set(0, 0);
  raio.setFromCamera(ndc, cam);
  const centro = raio.intersectObjects(alvos, false);
  return {
    cobertura: +(acertos / (GRADE * GRADE)).toFixed(3),
    centroNaCasa: centro.length > 0,
    distanciaCentro: centro.length > 0 ? +centro[0].distance.toFixed(2) : null,
  };
}

export function validarPlanos(
  planos: PoseDePlano[],
  casa: THREE.Object3D,
  camModelo: THREE.PerspectiveCamera,
  dentroDoEnvelope: (p: THREE.Vector3, folga?: number) => boolean,
): LaudoDePlano[] {
  const raio = new THREE.Raycaster();
  raio.far = 400;

  const alvos = malhasDeEdificio(casa, dentroDoEnvelope);
  if (alvos.length === 0) {
    return planos.map((p, i) => ({
      indice: i, titulo: p.titulo ?? `plano ${i}`, poses: [],
      atravessaFachada: false,
      problemas: ['nenhuma malha de edifício encontrada'],
    }));
  }

  // Caixas de mundo, calculadas UMA vez: o teste "câmera dentro de
  // sólido" faz 16 consultas e recomputar a caixa a cada uma seria
  // dezenas de milhares de traversals.
  const caixas = alvos.map((m) => {
    const b = new THREE.Box3().setFromObject(m, true);
    return { nome: m.name || m.geometry.type, b };
  }).filter((c) => isFinite(c.b.min.x));

  const cam = camModelo.clone();
  const laudos: LaudoDePlano[] = [];
  // Teto de tempo. Um validador que trava o boot é pior que nenhum
  // validador — foi o que aconteceu na primeira versão deste módulo.
  // Estourado o orçamento, os planos restantes saem marcados como não
  // medidos, em vez de a página ficar parada.
  const LIMITE_MS = 4000;
  const t0 = performance.now();
  let estourou = false;

  planos.forEach((p, i) => {
    const alvo = new THREE.Vector3(...p.alvo);
    const poses: [LaudoDePose['onde'], THREE.Vector3][] = [];
    if (p.partida) poses.push(['partida', new THREE.Vector3(...p.partida)]);
    poses.push(['chegada', new THREE.Vector3(...p.posicao)]);

    const laudo: LaudoDePlano = {
      indice: i, titulo: p.titulo ?? `plano ${i}`, poses: [],
      atravessaFachada: false, problemas: [],
    };

    for (const [onde, pos] of poses) {
      if (estourou || performance.now() - t0 > LIMITE_MS) {
        estourou = true;
        laudo.problemas.push(`${onde}: NAO MEDIDO — orçamento de ${LIMITE_MS} ms esgotado`);
        continue;
      }
      if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
        laudo.problemas.push(`${onde}: posição não finita`);
        continue;
      }
      cam.position.copy(pos);
      _dummy.position.copy(pos);
      _dummy.lookAt(alvo);
      cam.quaternion.copy(_dummy.quaternion);
      cam.updateMatrixWorld(true);

      // Grade de raios em NDC. `setFromCamera` já faz o desprojetar
      // correto para perspectiva, inclusive com o fov e o aspecto atuais.
      let acertos = 0;
      const ndc = new THREE.Vector2();
      for (let gy = 0; gy < GRADE; gy++) {
        for (let gx = 0; gx < GRADE; gx++) {
          ndc.set(
            (gx + 0.5) / GRADE * 2 - 1,
            (gy + 0.5) / GRADE * 2 - 1,
          );
          raio.setFromCamera(ndc, cam);
          if (raio.intersectObjects(alvos, false).length > 0) acertos++;
        }
      }
      ndc.set(0, 0);
      raio.setFromCamera(ndc, cam);
      const centro = raio.intersectObjects(alvos, false);

      const solidos = caixas
        .filter((c) => c.b.containsPoint(pos))
        .map((c) => c.nome).slice(0, 6);

      const pose: LaudoDePose = {
        onde, pos: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)],
        cobertura: +(acertos / (GRADE * GRADE)).toFixed(3),
        centroNaCasa: centro.length > 0,
        distanciaCentro: centro.length > 0 ? +centro[0].distance.toFixed(2) : null,
        dentroDoEnvelope: dentroDoEnvelope(pos, 0),
        dentroDeSolido: solidos,
      };
      laudo.poses.push(pose);

      if (pose.cobertura < COBERTURA_MINIMA) {
        laudo.problemas.push(
          `${onde}: só ${(pose.cobertura * 100).toFixed(1)}% do quadro é casa `
          + `(mínimo ${(COBERTURA_MINIMA * 100).toFixed(0)}%)`);
      }
      if (!pose.centroNaCasa) {
        laudo.problemas.push(`${onde}: o centro do quadro não encontra a casa`);
      }
      if (solidos.length > 0) {
        laudo.problemas.push(`${onde}: câmera dentro de ${solidos.join(', ')}`);
      }
      if (pos.y < 0.3) laudo.problemas.push(`${onde}: câmera a ${pos.y.toFixed(2)} m — abaixo do piso`);
    }

    if (laudo.poses.length === 2
        && laudo.poses[0].dentroDoEnvelope !== laudo.poses[1].dentroDoEnvelope) {
      laudo.atravessaFachada = true;
      laudo.problemas.push('partida e chegada em lados opostos da fachada: o voo atravessa parede');
    }

    laudos.push(laudo);
  });

  return laudos;
}
