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

interface Plano {
  nome: string;
  preco: string;
  unidade: string;
  itens: string[];
  destaque?: boolean;
}

const PLANOS: Plano[] = [
  {
    nome: 'Avulso',
    preco: 'sob consulta',
    unidade: 'por imóvel',
    itens: ['Uma residência completa', 'Até 12 capítulos', 'Link próprio', 'Entrega em 3 semanas'],
  },
  {
    nome: 'Mensal',
    preco: 'sob consulta',
    unidade: 'por mês',
    itens: ['Até 4 imóveis ativos', 'Trocas ilimitadas', 'Painel de métricas', 'Suporte prioritário'],
    destaque: true,
  },
  {
    nome: 'Premium',
    preco: 'sob consulta',
    unidade: 'por lançamento',
    itens: ['Portfólio inteiro', 'Domínio do incorporador', 'Integração com CRM', 'Acompanhamento dedicado'],
  },
];

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

  // ---- planos ----
  const grade = painel.querySelector('#planos') || (() => {
    const d = document.createElement('div');
    d.id = 'planos';
    painel.appendChild(d);
    return d;
  })();
  grade.innerHTML = PLANOS.map((p) => `
    <article class="plano${p.destaque ? ' destaque' : ''}">
      <h4>${p.nome}</h4>
      <p class="plano-preco">${p.preco}<span>${p.unidade}</span></p>
      <ul>${p.itens.map((i) => `<li>${i}</li>`).join('')}</ul>
      <button class="hero-btn primary plano-cta" data-plano="${p.nome}">Falar sobre o ${p.nome}</button>
    </article>`).join('');

  // ---- tilt 3D no hover ----
  // Só em ponteiro fino: num toque isto não existe, e tentar simular
  // deixa o card tremendo enquanto a pessoa rola a página.
  if (window.matchMedia('(pointer: fine)').matches) {
    grade.querySelectorAll<HTMLElement>('.plano').forEach((card) => {
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
  grade.querySelectorAll<HTMLElement>('.plano-cta').forEach((b) => {
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
  document.querySelectorAll('[data-abrir-comercial]').forEach((b) =>
    b.addEventListener('click', abrir));

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
