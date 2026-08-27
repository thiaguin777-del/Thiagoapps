// ============================================================
// ANALYTICS INTERNO
// ------------------------------------------------------------
// Duas perguntas de negócio que só isto responde:
//
//   "Em que cômodo o cliente PARA?"  -> onde investir modelagem.
//   "Em que tier o parque real cai?" -> se a promessa de fluidez está
//                                       sendo cumprida fora do desktop.
//
// Sem endpoint configurado não sai nada da máquina: os eventos ficam em
// memória e `exportar()` os despeja no console. É o padrão de propósito —
// quem clonar o repositório não manda dado de cliente para lugar nenhum
// sem ter escolhido isso.
// ============================================================

export interface Evento {
  t: number;                                   // ms desde o início da sessão
  nome: string;
  dados: Record<string, unknown>;
}

class Analytics {
  private eventos: Evento[] = [];
  private inicio = performance.now();
  private sessao = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  /** Preencher para enviar; vazio mantém tudo local. */
  public endpoint = '';
  private enviado = false;

  registrar(nome: string, dados: Record<string, unknown> = {}): void {
    this.eventos.push({ t: Math.round(performance.now() - this.inicio), nome, dados });
  }

  /** Tempo acumulado por capítulo, em segundos. */
  private tempoPorCapitulo(): Record<string, number> {
    const acc: Record<string, number> = {};
    let atual: string | null = null;
    let desde = 0;
    for (const e of this.eventos) {
      if (e.nome !== 'capitulo') continue;
      if (atual) acc[atual] = (acc[atual] || 0) + (e.t - desde) / 1000;
      atual = String(e.dados.titulo ?? e.dados.id ?? '?');
      desde = e.t;
    }
    if (atual) {
      const fim = performance.now() - this.inicio;
      acc[atual] = (acc[atual] || 0) + (fim - desde) / 1000;
    }
    for (const k in acc) acc[k] = +acc[k].toFixed(1);
    return acc;
  }

  resumo(): Record<string, unknown> {
    const hotspots = this.eventos.filter((e) => e.nome === 'hotspot').length;
    // `dados.tier` NUNCA existiu: o QualityController emite
    // {nivel, oque, fps}. O resumo reportava a string literal "undefined"
    // em tiers_visitados e tier_final — telemetria que parecia funcionar e
    // não media nada.
    const degraus = this.eventos.filter((e) => e.nome === 'qualidade')
      .map((e) => Number(e.dados.nivel));
    return {
      sessao: this.sessao,
      duracao_s: +((performance.now() - this.inicio) / 1000).toFixed(1),
      tempo_por_capitulo: this.tempoPorCapitulo(),
      hotspots_abertos: hotspots,
      degraus_de_qualidade: [...new Set(degraus)],
      degrau_final: degraus.length ? degraus[degraus.length - 1] : 0,
      eventos: this.eventos.length,
    };
  }

  exportar(): Record<string, unknown> {
    const r = this.resumo();
    console.info('[analytics] resumo da sessão', r);
    console.info('[analytics] eventos', this.eventos);
    return r;
  }

  enviar(): void {
    if (!this.endpoint || this.enviado) return;
    this.enviado = true;
    const corpo = JSON.stringify({ ...this.resumo(), eventos: this.eventos });
    try {
      // sendBeacon sobrevive ao fechamento da aba, que é exatamente quando
      // este pacote precisa sair. Um fetch normal seria cancelado.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(this.endpoint, new Blob([corpo], { type: 'application/json' }));
      } else {
        fetch(this.endpoint, {
          method: 'POST', keepalive: true, body: corpo,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch {
      // telemetria nunca pode derrubar a experiência
    }
  }
}

export const analytics = new Analytics();

window.addEventListener('pagehide', () => analytics.enviar());
// Atalho de auditoria: no console, `casaAuraAnalytics()`.
(window as unknown as Record<string, unknown>).casaAuraAnalytics = () => analytics.exportar();
