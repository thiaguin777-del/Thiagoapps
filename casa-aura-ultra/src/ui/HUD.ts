// ============================================================
// HUD — os controles que o corretor usa ao vivo
// ------------------------------------------------------------
// Por enquanto: o painel do Modo Seção. O resto da barra inferior
// (percurso solar, presets de luz, capítulos) continua vindo do legado e
// funciona — reconstruí-lo aqui só para dizer que é TypeScript trocaria
// uma coisa testada por uma coisa nova sem ganho para quem olha.
//
// O painel só aparece quando a seção está ligada. Um painel de corte
// sempre visível é ruído numa tela que já tem barra de tempo solar,
// presets, capítulos e modos — e o Modo Seção é justamente o momento em
// que o usuário QUER controle fino.
// ============================================================
import { corte, type Eixo } from '../effects/CutMode';

const EIXOS: { eixo: Eixo; rotulo: string; dica: string }[] = [
  { eixo: 'x', rotulo: 'Transversal', dica: 'Corte no sentido leste-oeste' },
  { eixo: 'z', rotulo: 'Longitudinal', dica: 'Corte no sentido norte-sul' },
  { eixo: 'y', rotulo: 'Planta', dica: 'Corte horizontal, como planta baixa' },
];

class Hud {
  private painel: HTMLElement | null = null;
  private botoes = new Map<Eixo, HTMLButtonElement>();
  private eixoAtual: Eixo = 'x';
  aoAlternar: ((ativo: boolean, eixo: Eixo) => void) | null = null;

  montar(): void {
    if (this.painel) return;
    this.criarPainel();
    this.assumirBotaoHerdado();
  }

  /**
   * `#btn-reveal` tinha o listener do legado, que ergue o volume superior
   * ("a maquete que abre"). A interceptação por captura no `document`
   * para o evento ANTES de ele chegar ao botão — ou seja, aquele efeito
   * deixou de ser alcançável.
   *
   * Escrevi aqui, antes, que ele "continua existindo". Não continua: um
   * botão só, um comportamento só. A troca é deliberada — a seção com
   * plano de corte mostra a distribuição melhor do que erguer a laje, e
   * ter dois modos disputando o mesmo botão seria pior que qualquer um
   * dos dois. Mas o comentário anterior descrevia algo que o código não
   * fazia, que é justamente o defeito que este projeto persegue.
   *
   * `toggleReveal` segue exportada e funcional para quem quiser religá-la
   * num botão próprio.
   */
  private assumirBotaoHerdado(): void {
    document.addEventListener('click', (e) => {
      const alvo = e.target as HTMLElement | null;
      if (!alvo?.closest('#btn-reveal')) return;
      e.stopPropagation();
      e.preventDefault();
      this.alternar(this.eixoAtual);
    }, true);
  }

  alternar(eixo: Eixo): void {
    const ativo = corte.alternar(eixo);
    this.eixoAtual = eixo;
    this.refletir(ativo);
    this.aoAlternar?.(ativo, eixo);
  }

  private refletir(ativo: boolean): void {
    document.body.dataset.corte = ativo ? '1' : '';
    const btn = document.getElementById('btn-reveal');
    if (btn) {
      btn.classList.toggle('active', ativo);
      btn.textContent = ativo ? 'Fechar Seção' : 'Modo Seção';
    }
    for (const [eixo, b] of this.botoes) {
      b.classList.toggle('active', ativo && eixo === this.eixoAtual);
    }
  }

  private criarPainel(): void {
    const p = document.createElement('div');
    p.id = 'painel-corte';
    p.innerHTML = `
      <div class="pc-titulo">Modo Seção</div>
      <div class="pc-eixos"></div>
      <label class="pc-linha">
        <span>Posição</span>
        <input type="range" id="corte-pos" min="0" max="100" value="50"
               aria-label="Posição do plano de corte">
      </label>
      <label class="pc-linha pc-check">
        <input type="checkbox" id="corte-fantasma" checked>
        <span>Mostrar o volume removido em arame</span>
      </label>`;
    document.body.appendChild(p);
    this.painel = p;

    const caixaEixos = p.querySelector('.pc-eixos')!;
    for (const { eixo, rotulo, dica } of EIXOS) {
      const b = document.createElement('button');
      b.className = 'pc-eixo';
      b.textContent = rotulo;
      b.title = dica;
      b.addEventListener('click', () => {
        // Clicar num eixo diferente TROCA o corte em vez de desligá-lo.
        // Desligar aqui obrigaria dois cliques para comparar dois cortes,
        // que é justamente o que se faz o tempo todo.
        if (corte.ativo && eixo !== this.eixoAtual) {
          this.eixoAtual = eixo;
          corte.ativar(eixo);
          this.refletir(true);
          this.aoAlternar?.(true, eixo);
          return;
        }
        this.alternar(eixo);
      });
      this.botoes.set(eixo, b);
      caixaEixos.appendChild(b);
    }

    const range = p.querySelector<HTMLInputElement>('#corte-pos')!;
    range.addEventListener('input', () => {
      corte.posicao = Number(range.value) / 100;
    });

    const chk = p.querySelector<HTMLInputElement>('#corte-fantasma')!;
    chk.addEventListener('change', () => { corte.fantasma = chk.checked; });

    // Teclado: setas movem o plano com precisão que o dedo não dá, e a
    // tecla C liga/desliga. É o tipo de atalho que um corretor aprende na
    // segunda apresentação e passa a usar sempre.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'c' || e.key === 'C') {
        if (!/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? '')) {
          this.alternar(this.eixoAtual);
        }
        return;
      }
      if (!corte.ativo) return;
      const passo = e.shiftKey ? 0.01 : 0.04;
      if (e.key === 'ArrowLeft') corte.posicao = corte.posicao - passo;
      else if (e.key === 'ArrowRight') corte.posicao = corte.posicao + passo;
      else return;
      e.preventDefault();
      range.value = String(Math.round(corte.posicao * 100));
    });
  }
}

export const hud = new Hud();
