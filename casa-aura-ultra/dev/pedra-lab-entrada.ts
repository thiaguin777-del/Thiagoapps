// @ts-nocheck
// BANCADA DO GRAMADO — mede a REPETIÇÃO VISÍVEL do ladrilho de grama.
//
// A ablação em cena (5 configurações num boot só) estabeleceu:
//
//   normal map desligado        -> pico 2D 0,2590 (era 0,2556): NÃO muda
//   map.repeat de 450 para 150  -> a defasagem migra de (-9,3) para (14,5)
//   os dois aliviados           -> 0,2284, apenas 11% menos
//
// Ou seja: a trama não vem do normal map (o comentário do código
// atribuía a ele), e o período está preso ao ladrilho do mapa DIFUSO.
// Como aliviar o repeat quase não reduz a intensidade, não é aliasing —
// é o ladrilho ser RECONHECÍVEL e se repetir. O suspeito são as 26
// manchas de raio 15%-45% do ladrilho: são elas a "assinatura" que o
// olho reencontra a cada 58 cm.
//
// Aqui o ladrilho é gerado, repetido 4x4, minificado para a densidade que
// tem na tela e medido pela mesma autocorrelação 2D usada na cena. Sem
// GPU e em segundos.
import { grassTexture } from '../src/legado/cena-bruta';

const raiz = document.getElementById('bancada')!;
raiz.innerHTML = '';

/** Autocorrelação 2D do maior pico fora da vizinhança — igual à da cena. */
function picoAuto(img: ImageData): { v: number; dx: number; dy: number } {
  const { width: w, height: h, data: d } = img;
  const L = new Float64Array(w * h);
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    L[k] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  }
  const R = 5, A = new Float64Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, n = 0;
    for (let bb = -R; bb <= R; bb++) for (let aa = -R; aa <= R; aa++) {
      const jj = j + bb, ii = i + aa;
      if (jj < 0 || jj >= h || ii < 0 || ii >= w) continue;
      s += L[jj * w + ii]; n++;
    }
    A[j * w + i] = L[j * w + i] - s / n;
  }
  let e0 = 0; for (let k = 0; k < w * h; k++) e0 += A[k] * A[k];
  e0 /= (w * h);
  let melhor = { v: -2, dx: 0, dy: 0 };
  const M = 14;
  for (let dy = 0; dy <= M; dy++) for (let dx = -M; dx <= M; dx++) {
    if (dy === 0 && dx <= 0) continue;
    if (Math.hypot(dx, dy) < 3) continue;
    let s = 0, n = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const jj = j + dy, ii = i + dx;
      if (jj < 0 || jj >= h || ii < 0 || ii >= w) continue;
      s += A[j * w + i] * A[jj * w + ii]; n++;
    }
    const v = s / (n * e0);
    if (v > melhor.v) melhor = { v: +v.toFixed(4), dx, dy };
  }
  return melhor;
}

/** Ladrilho de 58 cm visto a ~40 m ocupa ~17 px. 4x4 ladrilhos = 68 px. */
const PX_POR_LADRILHO = 17;
const N = 4;

interface Caso { nome: string; nota: string; opts: Record<string, number> }

const CASOS: Caso[] = [
  // O controle tem de ser o que a CENA USA HOJE, e não o que ela usava
  // antes desta bancada existir. Com `opts: {}` o painel "ATUAL" media
  // uma configuração que o projeto já não envia — uma bancada cujo
  // controle não é o código mede outra coisa.
  { nome: 'ATUAL (o que a cena envia)', nota: '26 manchas de raio 6%–16%',
    opts: { manchaMin: 0.06, manchaVar: 0.10 } },
  { nome: 'ANTERIOR', nota: '26 manchas de raio 15%–45% — a que tilava', opts: {} },
  { nome: 'Menores e mais', nota: '60 manchas de raio 5%–13%', opts: { manchas: 60, manchaMin: 0.05, manchaVar: 0.08 } },
  { nome: 'Sem manchas', nota: 'só as lâminas — o piso da comparação', opts: { manchas: 0 } },
];

for (const caso of CASOS) {
  const tex = grassTexture('#6f8a4f', caso.opts);
  const tile = tex.image as HTMLCanvasElement;

  const lado = PX_POR_LADRILHO * N;
  const min = document.createElement('canvas');
  min.width = min.height = lado;
  const g = min.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    g.drawImage(tile, x * PX_POR_LADRILHO, y * PX_POR_LADRILHO,
                PX_POR_LADRILHO, PX_POR_LADRILHO);
  }
  const pico = picoAuto(g.getImageData(0, 0, lado, lado));

  const grande = document.createElement('canvas');
  grande.width = grande.height = lado * 5;
  const g2 = grande.getContext('2d')!;
  g2.imageSmoothingEnabled = false;
  g2.drawImage(min, 0, 0, grande.width, grande.height);

  const box = document.createElement('div');
  box.className = 'painel';
  box.innerHTML = `<h2>${caso.nome}</h2><p class="nota">${caso.nota}</p>` +
    `<p class="nota"><strong>pico 2D = ${pico.v}</strong> em (${pico.dx}, ${pico.dy})</p>` +
    `<div class="leg">4x4 ladrilhos a 17 px cada (a densidade de ~40 m), ampliado 5x</div>`;
  box.appendChild(grande);
  const leg2 = document.createElement('div');
  leg2.className = 'leg'; leg2.textContent = 'ladrilho 1:1';
  box.appendChild(leg2);
  tile.className = 'umPorUm';
  box.appendChild(tile);
  raiz.appendChild(box);
  console.log(`${caso.nome}: pico ${pico.v} em (${pico.dx}, ${pico.dy})`);
}
(window as any).__bancadaPronta = true;
