// ============================================================
// FALLBACK — quando o WebGL não sobe
// ------------------------------------------------------------
// O fallback herdado mostrava um parágrafo de desculpas. Numa peça de
// VENDA isso é a pior resposta possível: o corretor mandou o link, o
// cliente abriu num aparelho velho, e a resposta foi "não deu".
//
// REGRA QUE ORGANIZA ESTE ARQUIVO: um fallback NÃO PODE DEPENDER DO QUE
// FALHOU. Nada aqui importa three.js, lê `scene`, ou usa qualquer dado
// preenchido por `init()`. As coordenadas abaixo são cópias literais das
// da cena, anotadas com a origem — se a casa mudar lá, muda aqui à mão,
// e essa duplicação é deliberada: é o preço de o fallback funcionar
// justamente quando o resto não funciona.
//
// O QUE ELE ENTREGA: a planta desenhada em canvas 2D, com os ambientes
// nomeados, mais a ficha técnica e o contato. É conteúdo real e útil —
// um comprador consegue entender a distribuição da casa — e roda em
// qualquer navegador com canvas, que é praticamente todos.
//
// O QUE ELE NÃO É: a galeria 360° do projeto original. Uma galeria
// precisa de panoramas, e não existe nenhum no repositório; desenhar
// retângulos e chamar de foto seria pior que não ter. Ver o relatório.
//
// A ÚNICA importação permitida aqui é `core/Contato`, e ela não fere a
// regra: é um módulo puro, sem dependência nenhuma, que só lê a URL e
// dois globais. Não toca em WebGL, não toca na cena, e não pode falhar
// pelo motivo que trouxe alguém até esta tela. Antes desta importação o
// fallback lia SÓ `?wa=`, então um deploy configurado por variável de
// ambiente perdia o contato justamente aqui — na única tela que sobrou.
// ============================================================
import { linkWhatsApp } from '../core/Contato';

/** Envelope construído, de HOUSE_ENVELOPE na cena. Metros. */
const CASA = { minX: -13.4, maxX: 12.4, minZ: -6.4, maxZ: 6.3 };
/** Piscina, de buildPoolAndDeck(): poolCx/poolCz/poolW/poolD. */
const PISCINA = { cx: -5.6, cz: 10.4, l: 10.2, p: 5.0 };
/** Deck ao redor da piscina, aproximado da mesma função. */
const DECK = { minX: -12.4, maxX: 4.0, minZ: 6.6, maxZ: 14.0 };

/** Ambientes, das posições de CONFIG.hotspots. [x, z, rótulo] */
const AMBIENTES: [number, number, string][] = [
  [-8.6, -1.2, 'Sala de estar'],
  [0.4, 0.9, 'Cozinha e jantar'],
  [6.7, -0.8, 'Suíte máster'],
  [3.4, -2.4, 'Núcleo em pedra'],
  [9.4, -6.3, 'Entrada'],
  [-5.2, 10.4, 'Piscina'],
  [1.2, 10.4, 'Área gourmet'],
  // A churrasqueira fica a 1,5 m da mesa do pergolado — dois rótulos tão
  // perto colidiriam na planta, e "Área gourmet" já cobre o conjunto.
  [-2.0, 4.0, 'Terraço'],
];

const FICHA: [string, string][] = [
  ['Pavimentos', 'Dois, com volume superior em balanço'],
  ['Área construída', 'Aproximadamente 320 m²'],
  ['Social', 'Estar, jantar e cozinha integrados'],
  ['Íntimo', 'Suíte máster com banheira de imersão'],
  ['Externo', 'Piscina com borda infinita, deck em ipê e área gourmet'],
  ['Fachada', 'Vidro do piso ao teto, estuque claro e núcleo em pedra'],
];

/** Converte metros do mundo para pixels do canvas, com margem. */
function projetor(largura: number, altura: number) {
  const minX = Math.min(CASA.minX, DECK.minX) - 3;
  const maxX = Math.max(CASA.maxX, DECK.maxX) + 3;
  const minZ = CASA.minZ - 3;
  const maxZ = Math.max(DECK.maxZ, PISCINA.cz + PISCINA.p / 2) + 3;
  const esc = Math.min(largura / (maxX - minX), altura / (maxZ - minZ));
  const dx = (largura - (maxX - minX) * esc) / 2;
  const dy = (altura - (maxZ - minZ) * esc) / 2;
  return {
    x: (m: number) => (m - minX) * esc + dx,
    y: (m: number) => (m - minZ) * esc + dy,
    esc,
  };
}

function desenharPlanta(cv: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const larg = cv.clientWidth || 640;
  const alt = cv.clientHeight || 420;
  cv.width = larg * dpr;
  cv.height = alt * dpr;
  const c = cv.getContext('2d');
  if (!c) return;
  c.scale(dpr, dpr);
  const P = projetor(larg, alt);

  c.fillStyle = '#14161a';
  c.fillRect(0, 0, larg, alt);

  // Jardim
  c.fillStyle = 'rgba(90, 120, 70, 0.16)';
  c.fillRect(0, 0, larg, alt);

  const ret = (x0: number, z0: number, x1: number, z1: number) =>
    [P.x(x0), P.y(z0), P.x(x1) - P.x(x0), P.y(z1) - P.y(z0)] as const;

  // Deck
  c.fillStyle = 'rgba(150, 110, 70, 0.30)';
  c.fillRect(...ret(DECK.minX, DECK.minZ, DECK.maxX, DECK.maxZ));

  // Piscina
  c.fillStyle = 'rgba(80, 180, 200, 0.55)';
  c.fillRect(...ret(
    PISCINA.cx - PISCINA.l / 2, PISCINA.cz - PISCINA.p / 2,
    PISCINA.cx + PISCINA.l / 2, PISCINA.cz + PISCINA.p / 2,
  ));

  // Casa
  c.fillStyle = 'rgba(232, 226, 214, 0.90)';
  c.fillRect(...ret(CASA.minX, CASA.minZ, CASA.maxX, CASA.maxZ));
  c.strokeStyle = 'rgba(20, 22, 26, 0.85)';
  c.lineWidth = 2;
  c.strokeRect(...ret(CASA.minX, CASA.minZ, CASA.maxX, CASA.maxZ));

  // Pano de vidro na face sul (z = maxZ): linha dupla fina.
  c.strokeStyle = '#3f9aad';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(P.x(CASA.minX + 1.5), P.y(CASA.maxZ));
  c.lineTo(P.x(CASA.maxX - 1.0), P.y(CASA.maxZ));
  c.stroke();

  // Rótulos
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const [x, z, nome] of AMBIENTES) {
    const px = P.x(x), py = P.y(z);
    c.fillStyle = '#c9a227';
    c.beginPath();
    c.arc(px, py, 3.5, 0, Math.PI * 2);
    c.fill();

    c.font = '500 11px Inter, system-ui, sans-serif';
    const larguraTexto = c.measureText(nome).width;
    // Caixa por trás do texto: sobre a casa clara, texto claro some.
    c.fillStyle = 'rgba(12, 14, 17, 0.78)';
    c.fillRect(px - larguraTexto / 2 - 5, py - 22, larguraTexto + 10, 15);
    c.fillStyle = '#e8e2d6';
    c.fillText(nome, px, py - 14.5);
  }

  // Escala: 5 m, para a planta ter dimensão e não só forma.
  const x0 = 16, y0 = alt - 18, cinco = 5 * P.esc;
  c.strokeStyle = 'rgba(232, 226, 214, 0.7)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x0, y0); c.lineTo(x0 + cinco, y0);
  c.moveTo(x0, y0 - 4); c.lineTo(x0, y0 + 4);
  c.moveTo(x0 + cinco, y0 - 4); c.lineTo(x0 + cinco, y0 + 4);
  c.stroke();
  c.textAlign = 'left';
  c.font = '400 10px Inter, system-ui, sans-serif';
  c.fillStyle = 'rgba(232, 226, 214, 0.7)';
  c.fillText('5 m', x0 + cinco + 6, y0);
}

/**
 * Monta o fallback. `motivo` vem do catálogo da cena e é mostrado só em
 * modo de depuração — o cliente vê a casa, não o erro.
 */
export function montarFallback(motivo?: string): void {
  if (document.getElementById('fallback-rico')) return;

  document.getElementById('loader')?.classList.add('hidden');
  document.getElementById('hero')?.classList.add('hidden');
  document.body.dataset.estado = 'FALLBACK';

  const raiz = document.createElement('div');
  raiz.id = 'fallback-rico';
  raiz.innerHTML = `
    <div class="fb-conteudo">
      <div class="fb-eyebrow">Projeto Conceitual</div>
      <h1>Casa Aura</h1>
      <p class="fb-nota">
        Este aparelho não conseguiu abrir a visita em 3D. A planta e a ficha
        do projeto estão abaixo — e podemos apresentar a casa por vídeo
        quando você quiser.
      </p>
      <canvas id="fb-planta" aria-label="Planta esquemática da Casa Aura"></canvas>
      <dl class="fb-ficha"></dl>
      <div class="fb-acoes">
        <a class="hero-btn primary" id="fb-whats" href="#" rel="noopener">Falar com o corretor</a>
      </div>
    </div>`;
  document.body.appendChild(raiz);

  const dl = raiz.querySelector('.fb-ficha')!;
  for (const [k, v] of FICHA) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }

  const cv = raiz.querySelector<HTMLCanvasElement>('#fb-planta')!;
  const redesenhar = () => desenharPlanta(cv);
  redesenhar();
  window.addEventListener('resize', redesenhar);

  // Uma fonte só para o contato — ver `core/Contato`.
  const link = raiz.querySelector<HTMLAnchorElement>('#fb-whats')!;
  const url = linkWhatsApp('Olá! Vi a Casa Aura e gostaria de saber mais.');
  if (url) {
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
  } else {
    link.remove();
  }

  if (motivo && new URLSearchParams(location.search).has('debug')) {
    const p = document.createElement('p');
    p.className = 'fb-motivo';
    p.textContent = `[debug] ${motivo}`;
    raiz.querySelector('.fb-conteudo')!.appendChild(p);
  }
}
