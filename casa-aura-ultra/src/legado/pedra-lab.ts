// @ts-nocheck
// ============================================================
// BANCADA DA PEDRA — ferramenta de desenvolvimento, fora do bundle
// ------------------------------------------------------------
// POR QUE ISTO EXISTE
//
// O núcleo em pedra lia como bloco de concreto. Ataquei duas vezes e
// piorei as duas, e a causa da segunda derrota foi de MÉTODO, não de
// gosto: eu mudava um parâmetro, rebuildava, subia a cena inteira
// (~10 min nesta máquina, sem GPU) e olhava o resultado já misturado com
// iluminação, névoa, tone mapping e vegetação aleatória. Nessas
// condições não dá para atribuir uma diferença à mudança que a causou.
//
// Aqui o mapa é gerado direto pelas MESMAS funções da cena
// (`heightField`, `carveCourses`, `pbrFromHeight` — importadas, não
// copiadas, senão a bancada mede outra coisa) e desenhado num canvas.
// Segundos por tentativa, e várias variantes lado a lado no mesmo
// quadro.
//
// A PARTE QUE EU TINHA ERRADO: escala de julgamento.
//
// Na captura da fachada a parede ocupa ~230 px de largura para 7,0 m de
// pedra. Com TILE_M = 1,6 são 4,4 ladrilhos em 230 px, ou seja ~52 px
// POR LADRILHO de 512 px — uma minificação de quase 10x. A junta de
// 9 mm, que no mapa tem 3 px, chega à tela com 0,3 px e some no mipmap.
// Eu estava julgando o mapa em 1:1 e decidindo sobre uma imagem que o
// olho nunca vê nesse tamanho. Por isso cada painel abaixo mostra as
// duas coisas: a parede na escala REAL de tela e o detalhe em 1:1.
// ============================================================
import { heightField, carveCourses, pbrFromHeight } from './cena-bruta';

const TILE_M = 1.6;
/** Trecho de parede visível acima da laje, medido na cena. */
const PAREDE_M = { largura: 7.0, altura: 2.8 };
/** Largura em pixels que essa parede ocupa na captura da fachada. */
const PAREDE_PX = 230;

export interface VarianteP {
  nome: string;
  nota?: string;
  octaves: number;
  baseFreq: number;
  courses: number;
  depth: number;
  jointWidth: number;
  /** albedo = tomBase + peca * tomFaixa + alt * grao */
  tomBase: number;
  tomFaixa: number;
  grao: number;
  cavityRadius: number;
  cavityGain: number;
  albedoCavity: number;
  aoStrength: number;
}

/**
 * O que está no código hoje, para servir de controle.
 *
 * MANTENHA EM SINCRONIA com o bloco do `stoneCore` em `cena-bruta.ts`.
 * Uma bancada cujo "controle" não é o código vira uma bancada que mede
 * outra coisa — que é exatamente o erro que ela existe para evitar.
 */
export const ATUAL: VarianteP = {
  nome: 'ATUAL (no código)',
  octaves: 5, baseFreq: 12,
  courses: 10, depth: 0.26, jointWidth: 0.003,
  tomBase: 104, tomFaixa: 32, grao: 26,
  cavityRadius: 3, cavityGain: 14, albedoCavity: 0.35, aoStrength: 1.0,
};

const _clamp255 = (v: number) => Math.max(0, Math.min(255, v));

/**
 * Gera o albedo de uma variante e devolve o CANVAS dele.
 *
 * `_texFromData` monta uma `CanvasTexture`, então `map.image` já é o
 * próprio `<canvas>` — não um objeto com `.data`, como eu tinha suposto
 * na primeira versão desta bancada (ela quebrou com "input data has zero
 * elements"). Melhor assim: o canvas vai direto para `drawImage`.
 */
export function gerarAlbedo(v: VarianteP, size = 512): HTMLCanvasElement {
  const h = heightField(size, {
    octaves: v.octaves, baseFreq: v.baseFreq, persistence: 0.5, seed: 53,
  });
  for (let i = 0; i < h.length; i++) h[i] = 0.45 + h[i] * 0.55;
  const tomBloco = carveCourses(h, size, {
    courses: v.courses, depth: v.depth, jointWidth: v.jointWidth, seed: 11,
  });
  const maps = pbrFromHeight(size, h, (alt, _cav, x, y, s) => {
    const peca = tomBloco[y * s + x];
    const val = v.tomBase + peca * v.tomFaixa + alt * v.grao;
    return [_clamp255(val * 1.03), _clamp255(val * 0.98), _clamp255(val * 0.88)];
  }, {
    normalStrength: 3.0, cavityRadius: v.cavityRadius, cavityGain: v.cavityGain,
    roughBase: 0.9, roughVar: 0.1, aoStrength: v.aoStrength,
    albedoCavity: v.albedoCavity,
  });
  const canvas = maps.map.image as HTMLCanvasElement;
  // Só o albedo é usado aqui; os outros três não vão para a GPU nesta
  // página, e soltá-los evita segurar dezenas de megabytes ao comparar
  // muitas variantes de uma vez.
  ['normalMap', 'roughnessMap', 'aoMap'].forEach((k) => (maps as any)[k]?.dispose?.());
  return canvas;
}

/**
 * Desenha o painel de uma variante: a parede na escala de tela REAL (e a
 * mesma ampliada 3x, porque 230 px é pequeno demais para o olho humano
 * julgar num relatório), mais o detalhe em 1:1.
 */
function painel(v: VarianteP, size: number): HTMLElement {
  const ladrilho = gerarAlbedo(v, size);

  const cols = PAREDE_M.largura / TILE_M;      // 4,375
  const rows = PAREDE_M.altura / TILE_M;       // 1,75
  const box = document.createElement('div');
  box.className = 'painel';

  const h = document.createElement('h2');
  h.textContent = v.nome;
  box.appendChild(h);
  if (v.nota) {
    const n = document.createElement('p');
    n.className = 'nota';
    n.textContent = v.nota;
    box.appendChild(n);
  }

  for (const [rotulo, escala] of [['parede na escala real da captura (230 px)', 1],
                                  ['a mesma, ampliada 3x', 3]] as const) {
    const leg = document.createElement('div');
    leg.className = 'leg';
    leg.textContent = rotulo;
    box.appendChild(leg);
    const c = document.createElement('canvas');
    c.width = Math.round(PAREDE_PX * escala);
    c.height = Math.round(PAREDE_PX * escala * (rows / cols));
    const g = c.getContext('2d')!;
    // `drawImage` com destino menor faz a minificação do navegador, que
    // é o análogo mais honesto do mipmap da GPU sem montar uma cena.
    g.imageSmoothingQuality = 'high';
    for (let ty = 0; ty < Math.ceil(rows); ty++) {
      for (let tx = 0; tx < Math.ceil(cols); tx++) {
        g.drawImage(ladrilho, (tx / cols) * c.width, (ty / rows) * c.height,
                    c.width / cols, c.height / rows);
      }
    }
    box.appendChild(c);
  }

  const leg = document.createElement('div');
  leg.className = 'leg';
  leg.textContent = 'ladrilho 1:1 (1,6 m) — só para ver o grão';
  box.appendChild(leg);
  ladrilho.className = 'umPorUm';
  box.appendChild(ladrilho);
  return box;
}

export function montarBancada(variantes: VarianteP[], size = 512): void {
  const raiz = document.getElementById('bancada') || document.body;
  raiz.innerHTML = '';
  for (const v of variantes) raiz.appendChild(painel(v, size));
  (window as any).__bancadaPronta = true;
}
