// ============================================================
// PRESENTATION_SAFE — a apresentação sem 3D
// ------------------------------------------------------------
// Isto NÃO é a tela de fallback. O fallback existe para quando o WebGL
// não sobe: é uma planta em canvas e uma ficha técnica, o mínimo digno.
//
// O modo seguro é outra coisa. O WebGL subiu, a cena existe, e o
// aparelho simplesmente não aguenta desenhá-la a uma taxa apresentável.
// Insistir ali entrega engasgo na frente de um cliente — e é justamente
// o momento em que o produto está sendo julgado.
//
// A regra que organiza este arquivo: **a jornada comercial continua
// inteira**. Explorar, capítulos, modo cinemático, planos e WhatsApp
// funcionam do mesmo jeito. O que muda é o meio: em vez de rasterizar a
// casa sessenta vezes por segundo, mostra-se um render dela — feito
// pela MESMA cena, na mesma composição de câmera dos capítulos.
//
// SOBRE OS RENDERS: são capturas reais da cena, geradas do próprio
// projeto e versionadas em `public/assets/renders/`. Se um deles não
// existir, o cartão daquele capítulo aparece com a legenda e sem
// imagem — nunca com uma imagem de outro lugar fingindo ser a casa.
// ============================================================

interface Capitulo {
  arquivo: string;
  titulo: string;
  legenda: string;
}

/**
 * Os capítulos do modo seguro, na ordem da apresentação. Os nomes de
 * arquivo são os das capturas geradas por `scripts/gerar-renders.mjs`.
 */
const CAPITULOS: Capitulo[] = [
  { arquivo: '1-exterior-dia', titulo: 'Chegada',
    legenda: 'Dois volumes em balanço, unidos por um núcleo de pedra.' },
  { arquivo: '2-interior-dia', titulo: 'O estar',
    legenda: 'O social se abre inteiro para a piscina. Sem corredor, sem transição.' },
  { arquivo: '3-golden-terraco', titulo: 'O terraço',
    legenda: 'O pavimento superior avança sobre a área social e cria a sombra do deck.' },
  { arquivo: '6-piscina-golden', titulo: 'A piscina',
    legenda: 'Borda infinita voltada para o jardim, deck em ipê e área gourmet coberta.' },
  { arquivo: '4-interior-noite', titulo: 'Interior à noite',
    legenda: 'Luz quente por dentro, vidro escuro por fora. É o contraste que define a casa.' },
  { arquivo: '5-exterior-noite', titulo: 'Casa Aura',
    legenda: 'Projeto conceitual completo. Vamos conversar sobre o seu.' },
];

let raiz: HTMLElement | null = null;
let indice = 0;
let aoAbrirComercial: (() => void) | null = null;

/** Cancelamento: nenhum timer sobrevive a uma saída do modo. */
const timers = new Set<number>();
function agendar(fn: () => void, ms: number): void {
  const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
  timers.add(id);
}
function limparTimers(): void {
  timers.forEach((id) => window.clearTimeout(id));
  timers.clear();
}

function irPara(i: number): void {
  if (!raiz) return;
  indice = Math.max(0, Math.min(CAPITULOS.length - 1, i));
  const c = CAPITULOS[indice];
  const img = raiz.querySelector<HTMLImageElement>('.ms-img');
  const cap = raiz.querySelector<HTMLElement>('.ms-legenda');
  const cont = raiz.querySelector<HTMLElement>('.ms-contador');
  if (img) {
    img.src = `./assets/renders/${c.arquivo}.jpg`;
    img.alt = `${c.titulo} — ${c.legenda}`;
  }
  if (cap) cap.innerHTML = `<strong>${c.titulo}</strong><em>${c.legenda}</em>`;
  if (cont) cont.textContent = `${indice + 1} / ${CAPITULOS.length}`;
  raiz.querySelectorAll<HTMLElement>('.ms-ponto').forEach((p, k) => {
    p.setAttribute('aria-current', k === indice ? 'true' : 'false');
  });
  // `aria-live` na legenda anuncia a troca para quem usa leitor de tela.
}

/** Modo cinemático do modo seguro: avança sozinho, e pode ser parado. */
let tocando = false;
function tocar(ligado: boolean): void {
  tocando = ligado;
  const b = raiz?.querySelector<HTMLElement>('.ms-tocar');
  if (b) {
    b.textContent = ligado ? 'Pausar' : 'Modo cinemático';
    b.setAttribute('aria-pressed', String(ligado));
  }
  if (!ligado) { limparTimers(); return; }
  const passo = () => {
    if (!tocando) return;
    irPara(indice + 1 >= CAPITULOS.length ? 0 : indice + 1);
    agendar(passo, 5000);
  };
  agendar(passo, 5000);
}

export function modoSeguroAtivo(): boolean {
  return raiz !== null;
}

export function sairDoModoSeguro(): void {
  limparTimers();
  tocando = false;
  raiz?.remove();
  raiz = null;
  document.body.dataset.modoSeguro = '';
}

/**
 * Monta a apresentação sem 3D. `abrirComercial` é injetado para que este
 * módulo não conheça a máquina de estados — ele só precisa saber pedir.
 */
export function montarModoSeguro(opcoes: {
  motivo: string;
  abrirComercial: () => void;
}): void {
  if (raiz) return;
  aoAbrirComercial = opcoes.abrirComercial;
  document.body.dataset.modoSeguro = '1';

  const el = document.createElement('section');
  el.id = 'modo-seguro';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Apresentação da Casa Aura');
  el.innerHTML = `
    <div class="ms-quadro">
      <img class="ms-img" alt="" decoding="async" />
      <div class="ms-legenda" aria-live="polite"></div>
    </div>
    <nav class="ms-barra" aria-label="Capítulos">
      <button class="ms-btn ms-ant" aria-label="Capítulo anterior">‹</button>
      <div class="ms-pontos" role="tablist">
        ${CAPITULOS.map((c, i) =>
          `<button class="ms-ponto" role="tab" data-i="${i}" aria-label="${c.titulo}"></button>`).join('')}
      </div>
      <span class="ms-contador" aria-hidden="true"></span>
      <button class="ms-btn ms-prox" aria-label="Próximo capítulo">›</button>
    </nav>
    <div class="ms-acoes">
      <button class="hero-btn ms-tocar" aria-pressed="false">Modo cinemático</button>
      <button class="hero-btn primary ms-planos">Ver planos e valores</button>
    </div>
    <p class="ms-nota">
      Este aparelho não sustentou a navegação 3D em tempo real, então a
      apresentação está rodando por imagens da própria cena. Num aparelho
      mais recente ela é navegável em tempo real.
    </p>`;
  document.body.appendChild(el);
  raiz = el;

  el.querySelector('.ms-ant')!.addEventListener('click', () => { tocar(false); irPara(indice - 1); });
  el.querySelector('.ms-prox')!.addEventListener('click', () => { tocar(false); irPara(indice + 1); });
  el.querySelectorAll<HTMLElement>('.ms-ponto').forEach((p) => {
    p.addEventListener('click', () => { tocar(false); irPara(Number(p.dataset.i)); });
  });
  el.querySelector('.ms-tocar')!.addEventListener('click', () => tocar(!tocando));
  el.querySelector('.ms-planos')!.addEventListener('click', () => {
    tocar(false);
    aoAbrirComercial?.();
  });

  // Teclado: setas navegam, Escape para o cinemático. Sem isto o modo
  // seguro seria menos acessível que a cena 3D, o que inverteria o
  // propósito dele.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { tocar(false); irPara(indice - 1); }
    else if (e.key === 'ArrowRight') { tocar(false); irPara(indice + 1); }
    else if (e.key === 'Escape' && tocando) { tocar(false); }
  });
  el.tabIndex = -1;
  el.focus({ preventScroll: true });

  // Uma imagem que não existe não pode virar ícone de imagem quebrada no
  // meio de uma apresentação comercial.
  const img = el.querySelector<HTMLImageElement>('.ms-img')!;
  img.addEventListener('error', () => {
    img.removeAttribute('src');
    img.classList.add('ms-sem-imagem');
  });

  irPara(0);
  console.info(`[modo-seguro] ativo — ${opcoes.motivo}`);
}
