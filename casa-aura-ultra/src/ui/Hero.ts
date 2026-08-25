// ============================================================
// HERO — a primeira tela
// ------------------------------------------------------------
// A entrada do texto é feita letra a letra no título e linha a linha no
// resto. Não é enfeite: o hero fica por cima de uma cena 3D que acabou de
// subir, e uma entrada escalonada dá ao olho um caminho de leitura —
// sobrenome, título, promessa, ação — em vez de despejar quatro blocos de
// uma vez sobre uma imagem que já é complexa.
//
// GSAP faz o trabalho. O split de texto é feito à mão porque o SplitText
// oficial é plugin pago do Club GreenSock: para um título de duas
// palavras, envolver cada caractere num <span> é uma função de dez linhas
// e não tem licença nenhuma envolvida.
//
// ACESSIBILIDADE: quebrar o título em spans destrói a leitura por leitor
// de tela, que passaria a soletrar. Por isso o h1 recebe `aria-label` com
// o texto íntegro e os spans viram `aria-hidden`. E quem pediu menos
// movimento no sistema recebe tudo já posicionado, sem animação alguma.
// ============================================================
import { gsap } from 'gsap';

const MENOS_MOVIMENTO =
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Envolve cada caractere num span. Espaços viram `&nbsp;` para não colapsar. */
function separarLetras(el: HTMLElement): HTMLElement[] {
  const texto = el.textContent ?? '';
  el.setAttribute('aria-label', texto);
  el.textContent = '';
  const spans: HTMLElement[] = [];
  for (const ch of texto) {
    const s = document.createElement('span');
    s.className = 'letra';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = ch === ' ' ? ' ' : ch;
    el.appendChild(s);
    spans.push(s);
  }
  return spans;
}

export function animarHero(): void {
  const hero = document.getElementById('hero');
  if (!hero) return;

  const titulo = hero.querySelector<HTMLElement>('.hero-title');
  const sobrenome = hero.querySelector<HTMLElement>('.hero-eyebrow');
  const lede = hero.querySelector<HTMLElement>('.hero-lede');
  const acoes = hero.querySelector<HTMLElement>('.hero-actions');

  if (MENOS_MOVIMENTO) {
    // Sem animação, mas TAMBÉM sem estado inicial escondido — o erro
    // clássico aqui é pular a timeline e deixar tudo com opacity 0.
    [sobrenome, titulo, lede, acoes].forEach((el) => {
      if (el) { el.style.opacity = '1'; el.style.transform = 'none'; }
    });
    return;
  }

  const letras = titulo ? separarLetras(titulo) : [];

  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  if (sobrenome) {
    tl.fromTo(sobrenome,
      { opacity: 0, y: 14, letterSpacing: '0.5em' },
      { opacity: 1, y: 0, letterSpacing: '0.28em', duration: 1.0 }, 0);
  }

  if (letras.length) {
    // `stagger` pequeno e duração longa: as letras se sobrepõem muito, o
    // que lê como uma palavra emergindo, não como máquina de escrever.
    tl.fromTo(letras,
      { opacity: 0, y: 26, rotateX: -55 },
      { opacity: 1, y: 0, rotateX: 0, duration: 1.1, stagger: 0.045 }, 0.18);
  }

  if (lede) {
    tl.fromTo(lede, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.9 }, 0.7);
  }
  if (acoes) {
    tl.fromTo(acoes, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8 }, 0.95);
  }
}

/**
 * EFEITO MAGNÉTICO nos botões: o botão se desloca alguns pixels na
 * direção do cursor quando ele chega perto. Custa quase nada e muda a
 * sensação da página inteira — o botão deixa de ser um retângulo e passa
 * a responder à intenção antes do clique.
 *
 * Só em ponteiro FINO. Em toque não existe hover, e o efeito viraria um
 * salto do botão no momento em que o dedo encosta — ou seja, o alvo
 * fugindo do dedo.
 */
export function ligarBotoesMagneticos(seletor = '.hero-btn, .mode-btn'): void {
  if (MENOS_MOVIMENTO) return;
  if (typeof matchMedia === 'function' && !matchMedia('(pointer: fine)').matches) return;

  const RAIO = 70;   // px de distância em que o botão começa a responder
  const FORCA = 0.28;

  document.querySelectorAll<HTMLElement>(seletor).forEach((btn) => {
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > RAIO + Math.max(r.width, r.height) / 2) return;
      gsap.to(btn, { x: dx * FORCA, y: dy * FORCA, duration: 0.4, ease: 'power2.out' });
    });
    btn.addEventListener('pointerleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.55, ease: 'elastic.out(1, 0.4)' });
    });
  });
}
