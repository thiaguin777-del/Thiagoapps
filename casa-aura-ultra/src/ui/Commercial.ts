// ============================================================
// PAINEL COMERCIAL
// ------------------------------------------------------------
// É a parte do produto que fecha negócio, e por isso ela tem uma regra
// própria: NUNCA interromper. O painel aparece quando o visitante pede
// ("Saiba mais") ou quando ele já demonstrou interesse ficando 60 s na
// casa — e mesmo então, com um convite discreto, não com um modal por
// cima da experiência que ele estava gostando.
//
// A contagem de 60 s conta tempo EXPLORANDO, não tempo com a aba aberta:
// alguém que abriu e foi almoçar não demonstrou interesse nenhum.
// ============================================================
import { gsap } from 'gsap';
import type { StateMachine } from '../core/StateMachine';
import { analytics } from '../core/Analytics';

const SEGUNDOS_ATE_CONVITE = 60;

// NAO existe aqui uma lista de planos. Ela ficava aqui, com precos "sob
// consulta" e itens como "Integracao com CRM" que EU inventei — e o
// index.html ja traz o bloco `.plans` com os precos reais que o Thiago
// definiu. O resultado eram duas tabelas de preco contraditorias na mesma
// tela, e a minha ainda anunciava condicao comercial que ninguem
// combinou. Termo comercial nao se inventa: este modulo agora so
// ENRIQUECE o bloco que ja existe.

/** Contador que sobe até o alvo. Substitui a dependência countUp.js. */
function contarAte(el: HTMLElement, alvo: number, sufixo = '', duracao = 1.6): void {
  const estado = { v: 0 };
  gsap.to(estado, {
    v: alvo,
    duration: duracao,
    ease: 'power2.out',
    onUpdate: () => {
      const n = alvo % 1 === 0 ? Math.round(estado.v) : estado.v.toFixed(1);
      el.textContent = String(n) + sufixo;
    },
  });
}

export function montarComercial(fsm: StateMachine): void {
  const painel = document.getElementById('commercial');
  if (!painel) return;

  // ---- planos: o bloco real do HTML, com um CTA por plano ----
  // Os precos e as descricoes sao os do markup. O que este trecho
  // acrescenta e um botao por plano que leva ao WhatsApp ja dizendo QUAL
  // plano interessou — que e a informacao que faltava chegar do outro
  // lado da conversa.
  const grade = painel.querySelector<HTMLElement>('.plans');
  grade?.querySelectorAll<HTMLElement>('.plan').forEach((card) => {
    const nome = card.querySelector('.plan-name')?.textContent?.trim() || 'plano';
    if (card.querySelector('.plano-cta')) return;
    const b = document.createElement('button');
    b.className = 'hero-btn primary plano-cta';
    b.dataset.plano = nome;
    b.textContent = `Falar sobre o ${nome}`;
    card.appendChild(b);
  });

  // ---- tilt 3D no hover ----
  // Só em ponteiro fino: num toque isto não existe, e tentar simular
  // deixa o card tremendo enquanto a pessoa rola a página.
  if (window.matchMedia('(pointer: fine)').matches) {
    grade?.querySelectorAll<HTMLElement>('.plan').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - 0.5;
        const dy = (e.clientY - r.top) / r.height - 0.5;
        gsap.to(card, {
          rotateY: dx * 9, rotateX: -dy * 9, transformPerspective: 900,
          duration: 0.4, ease: 'power2.out',
        });
      });
      card.addEventListener('pointerleave', () => {
        gsap.to(card, { rotateY: 0, rotateX: 0, duration: 0.6, ease: 'power3.out' });
      });
    });
  }

  // ---- contadores ----
  // Disparam quando a seção entra na tela, não no load: um número que já
  // subiu antes de ser visto não conta história nenhuma.
  const obs = new IntersectionObserver((entradas) => {
    entradas.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target as HTMLElement;
      contarAte(el, Number(el.dataset.alvo || '0'), el.dataset.sufixo || '');
      obs.unobserve(el);
    });
  }, { threshold: 0.4 });
  painel.querySelectorAll<HTMLElement>('[data-alvo]').forEach((el) => obs.observe(el));

  // ---- CTA WhatsApp com mensagem pré-preenchida ----
  grade?.querySelectorAll<HTMLElement>('.plano-cta').forEach((b) => {
    b.addEventListener('click', () => {
      const plano = b.dataset.plano || '';
      analytics.registrar('cta_plano', { plano });
      abrirWhatsApp(`Olá! Vi a Casa Aura e quero saber sobre o plano ${plano}.`);
    });
  });

  // ---- entrada no painel ----
  const abrir = () => {
    if (fsm.atual() === 'COMMERCIAL') return;
    analytics.registrar('abriu_comercial', { origem: 'botao' });
    fsm.ir('COMMERCIAL', () => {
      painel.classList.add('visible');
      painel.scrollIntoView({ behavior: 'auto' });
    });
  };
  // `[data-abrir-comercial]` nao existe em lugar nenhum do HTML: este
  // laco percorria uma lista vazia e o painel nao tinha botao de entrada.
  // Quem abre o comercial no markup herdado e `#btn-commercial`; o
  // convite de 60 s e o fim da apresentacao tambem chamam `abrir()`.
  document.querySelectorAll('#btn-commercial, [data-abrir-comercial]')
    .forEach((b) => b.addEventListener('click', abrir));

  // FECHAR: o `#comm-close` do legado so tira a classe `.visible`, sem
  // avisar a FSM. O estado ficava presoem COMMERCIAL e, a partir dai, a
  // tabela de transicoes recusava "Apresentacao" para sempre.
  document.getElementById('comm-close')?.addEventListener('click', () => {
    if (fsm.atual() !== 'COMMERCIAL') return;
    fsm.ir('EXPLORING', () => painel.classList.remove('visible'));
  });

  // ---- convite após 60 s EXPLORANDO ----
  let segundos = 0;
  const relogio = window.setInterval(() => {
    if (fsm.atual() !== 'EXPLORING') return;   // só conta tempo de fato explorando
    segundos++;
    if (segundos < SEGUNDOS_ATE_CONVITE) return;
    window.clearInterval(relogio);
    mostrarConvite(abrir);
  }, 1000);
}

/** Convite discreto no canto. Nunca um modal por cima da cena. */
function mostrarConvite(aoAceitar: () => void): void {
  if (document.getElementById('convite-comercial')) return;
  const el = document.createElement('div');
  el.id = 'convite-comercial';
  el.innerHTML =
    `<p>Gostou do que viu?</p>
     <button class="hero-btn primary" id="convite-sim">Quanto custa no meu lançamento</button>
     <button class="convite-nao" aria-label="Dispensar">×</button>`;
  document.body.appendChild(el);
  gsap.fromTo(el, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: 'power3.out' });
  el.querySelector('#convite-sim')!.addEventListener('click', () => {
    analytics.registrar('abriu_comercial', { origem: 'convite_60s' });
    el.remove();
    aoAceitar();
  });
  el.querySelector('.convite-nao')!.addEventListener('click', () => {
    analytics.registrar('dispensou_convite', {});
    gsap.to(el, { autoAlpha: 0, y: 12, duration: 0.3, onComplete: () => el.remove() });
  });
}

export function abrirWhatsApp(mensagem: string): void {
  const numero = (window as unknown as { CASA_AURA_WHATSAPP?: string }).CASA_AURA_WHATSAPP
    || new URLSearchParams(location.search).get('wa')
    || '';
  if (!numero) {
    console.info('[comercial] número de WhatsApp não configurado — CTA inerte');
    return;
  }
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
  window.open(url, '_blank', 'noopener');
}
