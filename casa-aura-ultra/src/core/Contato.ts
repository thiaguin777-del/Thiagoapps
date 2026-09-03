// ============================================================
// CONTATO — uma fonte de verdade para o número de WhatsApp
// ------------------------------------------------------------
// DEFEITO ENCONTRADO na auditoria de fechamento: havia TRÊS
// implementações independentes do número, com regras diferentes, e elas
// discordavam entre si.
//
//   `wireWhatsappCTA` (legado)   lê CONFIG.whatsappThiago ou ?wa=,
//                                valida com /^\d{10,15}$/, e ESCONDE o
//                                botão quando não há número. Honesto.
//   `abrirWhatsApp` (Commercial) lê window.CASA_AURA_WHATSAPP ou ?wa=.
//                                NÃO lê CONFIG. Sem validação. Quando
//                                não há número, faz `return` com um
//                                console.info — o botão continua com
//                                cara de funcional e não faz nada.
//   `Fallback`                   lê SÓ ?wa=. Remove o link se faltar.
//
// Consequência real: configurar por `CONFIG.whatsappThiago` fazia o CTA
// do herói funcionar e deixava os três botões de plano MORTOS. Configurar
// por `window.CASA_AURA_WHATSAPP` fazia o inverso. Só `?wa=` acertava os
// três — e é justamente o caminho que o corretor não usa quando publica.
//
// Aqui a leitura é uma só, na ordem de precedência que faz sentido para
// quem publica:
//
//   1. `?wa=` na URL          — o corretor manda o link já com o número
//   2. `window.CASA_AURA_WHATSAPP` — injetado no deploy (ver
//                                CONFIGURACAO_PRODUCAO.md)
//   3. `CONFIG.whatsappThiago` — editado no código
//
// E há um valor de placeholder explícito: `5561900000000` NÃO conta como
// configurado. Um número inventado que parece real é pior que nenhum.
// ============================================================

/** O placeholder que veio no código. Nunca é aceito como configuração. */
const PLACEHOLDER = '5561900000000';

/**
 * Formato internacional sem símbolos: código do país + DDD + número.
 * `wa.me` não aceita `+`, espaços nem parênteses.
 */
const FORMATO = /^\d{10,15}$/;

/**
 * NORMALIZAÇÃO PARA O BRASIL — e isto é uma armadilha real, não zelo.
 *
 * O número brasileiro escrito do jeito que todo mundo escreve —
 * `61993666859`, DDD mais celular — tem 11 dígitos e passa numa
 * validação ingênua de "10 a 15 dígitos". Só que `wa.me` interpreta o
 * começo como CÓDIGO DE PAÍS, e `61` é a Austrália. O link fica válido,
 * o botão funciona, o WhatsApp abre — e a conversa vai para o outro lado
 * do mundo, ou para lugar nenhum. É o pior tipo de defeito num caminho
 * de venda: silencioso e plausível.
 *
 * Regra: se o número tem 10 ou 11 dígitos e começa por um DDD brasileiro
 * válido (11 a 99, sem DDD terminado em 0 ou 1 além dos reais), assume-se
 * Brasil e o 55 é acrescentado. Números com 12 dígitos ou mais são
 * tratados como já tendo código de país.
 *
 * O aviso no console é deliberado: quem configurou precisa saber que o
 * número foi completado, para conferir.
 */
function normalizar(bruto: string): string {
  const d = String(bruto).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) {
    const ddd = Number(d.slice(0, 2));
    if (ddd >= 11 && ddd <= 99) {
      console.info(`[contato] número "${d}" sem código de país; assumindo Brasil (+55). `
        + 'Para outro país, configure com o código incluído.');
      return '55' + d;
    }
  }
  return d;
}

let _configurado: string | null | undefined;

/**
 * O número configurado, ou `null`. O resultado é memorizado: a resposta
 * não muda durante a sessão e três módulos consultam isto.
 */
export function numeroDeContato(): string | null {
  if (_configurado !== undefined) return _configurado;

  const candidatos: (string | null | undefined)[] = [];
  try {
    candidatos.push(new URLSearchParams(location.search).get('wa'));
  } catch { /* location pode não existir em teste */ }
  const w = window as unknown as {
    CASA_AURA_WHATSAPP?: string;
    __auraConfigLegado?: { whatsappThiago?: string };
  };
  candidatos.push(w.CASA_AURA_WHATSAPP);
  candidatos.push(w.__auraConfigLegado?.whatsappThiago);

  for (const c of candidatos) {
    if (!c) continue;
    const limpo = normalizar(c);
    if (limpo === PLACEHOLDER) continue;
    if (FORMATO.test(limpo)) { _configurado = limpo; return _configurado; }
  }
  _configurado = null;
  return null;
}

/** Para teste: força uma releitura. Não usado em produção. */
export function esquecerContato(): void {
  _configurado = undefined;
}

export function contatoConfigurado(): boolean {
  return numeroDeContato() !== null;
}

/**
 * O link do WhatsApp com a mensagem já escrita, ou `null` quando não há
 * número. Quem chama DEVE tratar o `null` desabilitando o controle — não
 * deixando um botão vivo que não faz nada.
 */
export function linkWhatsApp(mensagem: string): string | null {
  const n = numeroDeContato();
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * Desabilita um controle de contato de forma VISÍVEL e explica por quê.
 *
 * A regra do fechamento é explícita: sem número configurado o CTA fica
 * desabilitado ou mostra a instrução de configuração; nunca parece
 * funcional e falha em silêncio. Um botão morto com aparência de vivo
 * queima a demonstração na frente do cliente.
 */
export function desabilitarPorFaltaDeContato(el: HTMLElement, rotulo?: string): void {
  el.setAttribute('aria-disabled', 'true');
  el.setAttribute('data-sem-contato', '1');
  el.setAttribute('title', 'Contato de WhatsApp não configurado — ver CONFIGURACAO_PRODUCAO.md');
  if (el instanceof HTMLButtonElement) el.disabled = true;
  if (el instanceof HTMLAnchorElement) el.removeAttribute('href');
  if (rotulo) el.textContent = rotulo;
}
