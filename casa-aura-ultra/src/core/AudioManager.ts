// ============================================================
// ÁUDIO ESPACIAL — gerado, não baixado
// ------------------------------------------------------------
// O manifesto da cena pede `ambient_garden.mp3` e `water_loop.mp3`. Esses
// arquivos NÃO EXISTEM no repositório, e nunca existiram. Um AudioManager
// que aponta para eles seria um player bonito com nada para tocar — e o
// botão de som ficaria ligando o silêncio.
//
// A saída não é esperar por arquivos: é SINTETIZAR. Vento em folhagem e
// lâmina d'água são, os dois, ruído filtrado com envoltória lenta. Isso
// se escreve em cinquenta linhas, soa convincente, custa zero byte de
// download e zero licença. É melhor do que um MP3 genérico de banco de
// sons, que sempre traz um pássaro identificável que repete a cada 30 s.
//
// COMO CHEGA NO HOWLER: os buffers viram um WAV de 16 bits em memória,
// que vira um Blob, que vira uma URL. O Howler carrega dali como
// carregaria de qualquer arquivo — e ganhamos o espacializador e o
// controle de fade dele sem depender de asset externo.
//
// MONO, DE PROPÓSITO: o PannerNode só posiciona fonte MONO. Um WAV
// estéreo é reproduzido sem panorâmica e o áudio "espacial" viraria um
// fundo chapado.
//
// AUTOPLAY: nenhum navegador deixa tocar antes de um gesto do usuário, e
// isso está certo. O som só começa no clique, e o botão diz o que vai
// acontecer antes de acontecer.
// ============================================================
import { Howl, Howler } from 'howler';

const TAXA = 22050;
const SEGUNDOS = 12;
/** Cauda usada para casar o fim com o começo e o laço não estalar. */
const CRUZAMENTO = 0.9;

/** Ruído branco -> filtro de um polo. `k` perto de 1 = mais grave. */
function passaBaixa(entrada: Float32Array, k: number): Float32Array {
  const s = new Float32Array(entrada.length);
  let y = 0;
  for (let i = 0; i < entrada.length; i++) {
    y += (entrada[i] - y) * (1 - k);
    s[i] = y;
  }
  return s;
}

function ruido(n: number, semente: number): Float32Array {
  const s = new Float32Array(n);
  // Gerador próprio em vez de Math.random: o mesmo som em toda sessão,
  // o que torna qualquer defeito reproduzível.
  let x = semente >>> 0;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    s[i] = (x / 0xffffffff) * 2 - 1;
  }
  return s;
}

/**
 * Cruza o fim com o começo. Sem isto o laço tem uma descontinuidade a
 * cada volta — um "toc" que o ouvido pega imediatamente e que é a marca
 * registrada de ambiente mal feito.
 */
function fecharLaco(s: Float32Array): Float32Array {
  const n = s.length;
  const c = Math.floor(CRUZAMENTO * TAXA);
  const saida = s.slice(0, n - c);
  for (let i = 0; i < c; i++) {
    const t = i / c;
    saida[i] = saida[i] * t + s[n - c + i] * (1 - t);
  }
  return saida;
}

/** Vento em folhagem: grave com sopros lentos por cima. */
function gerarJardim(): Float32Array {
  const n = TAXA * SEGUNDOS;
  const base = passaBaixa(ruido(n, 0x9e3779b9), 0.86);
  const folhas = passaBaixa(ruido(n, 0x85ebca6b), 0.55);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / TAXA;
    // Três LFOs incomensuráveis: a envoltória nunca repete dentro do laço.
    const sopro =
      0.55 + 0.25 * Math.sin(t * 0.21 * Math.PI * 2)
           + 0.12 * Math.sin(t * 0.073 * Math.PI * 2 + 1.7)
           + 0.08 * Math.sin(t * 0.37 * Math.PI * 2 + 4.1);
    s[i] = (base[i] * 0.7 + folhas[i] * 0.30 * Math.max(0, sopro)) * sopro * 0.5;
  }
  return fecharLaco(s);
}

/** Lâmina d'água: mais agudo que o vento, com ondulação mais rápida. */
function gerarAgua(): Float32Array {
  const n = TAXA * SEGUNDOS;
  const corpo = passaBaixa(ruido(n, 0xc2b2ae35), 0.72);
  const brilho = passaBaixa(ruido(n, 0x27d4eb2f), 0.30);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / TAXA;
    const onda =
      0.6 + 0.22 * Math.sin(t * 0.9 * Math.PI * 2)
          + 0.14 * Math.sin(t * 1.63 * Math.PI * 2 + 0.9);
    // O brilho é o que dá a leitura de ÁGUA e não de chuveiro: ele entra
    // só nos picos da onda, como o respingo da borda infinita.
    const pico = Math.max(0, onda - 0.72) * 3.4;
    s[i] = (corpo[i] * 0.55 * onda + brilho[i] * 0.30 * pico) * 0.5;
  }
  return fecharLaco(s);
}

/** Empacota PCM float em um WAV mono de 16 bits e devolve uma URL. */
function urlDeWav(amostras: Float32Array): string {
  const n = amostras.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE');
  txt(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);          // PCM
  v.setUint16(22, 1, true);          // mono
  v.setUint32(24, TAXA, true);
  v.setUint32(28, TAXA * 2, true);   // bytes por segundo
  v.setUint16(32, 2, true);          // alinhamento de bloco
  v.setUint16(34, 16, true);         // bits
  txt(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, amostras[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

interface Fonte {
  som: Howl;
  id: number;
  pos: [number, number, number];
  volume: number;
  url: string;
  /** Timer da pausa com fade, para poder ser cancelado ao religar. */
  timerPausa?: number;
}

export class AudioManager {
  private fontes: Fonte[] = [];
  private ligado = false;
  private montado = false;
  /** Volume mestre, também usado pelo fade da apresentação. */
  private mestre = 0.55;

  /**
   * Gera os buffers e cria as fontes — mas NÃO toca. Pode ser chamado a
   * qualquer momento; o som só sai depois de `alternar()` a partir de um
   * gesto do usuário.
   */
  montar(): void {
    if (this.montado) return;
    this.montado = true;

    const t0 = performance.now();
    const jardim = urlDeWav(gerarJardim());
    const agua = urlDeWav(gerarAgua());
    console.info(`[audio] ambiente sintetizado em ${(performance.now() - t0).toFixed(0)} ms`);

    // Posições reais na cena: o jardim ao norte, atrás da casa; a água na
    // piscina (poolCx/poolCz de buildPoolAndDeck).
    this.criar(jardim, [-2, 1.5, -12], 0.42);
    this.criar(agua, [-5.6, 0.4, 10.4], 0.5);

    Howler.volume(this.mestre);
    // O modelo de atenuação importa: `inverse` cai rápido demais numa cena
    // de dezenas de metros e a piscina some assim que a câmera recua.
    // `linear` com raio máximo casa com a escala da casa.
  }

  private criar(url: string, pos: [number, number, number], volume: number): void {
    const som = new Howl({
      src: [url],
      format: ['wav'],
      loop: true,
      volume: 0,
      // `html5: false` mantém o som no WebAudio, que é o único caminho
      // onde a espacialização existe.
      html5: false,
    });
    const id = som.play();
    som.pause(id);
    som.pos(pos[0], pos[1], pos[2], id);
    som.pannerAttr({
      panningModel: 'HRTF',
      distanceModel: 'linear',
      refDistance: 3,
      maxDistance: 45,
      rolloffFactor: 0.9,
    }, id);
    this.fontes.push({ som, id, pos, volume, url });
  }

  /** Liga/desliga com fade. Só funciona a partir de um gesto do usuário. */
  alternar(): boolean {
    this.montar();
    this.ligado = !this.ligado;
    for (const f of this.fontes) {
      if (this.ligado) {
        if (f.timerPausa !== undefined) {
          window.clearTimeout(f.timerPausa);
          f.timerPausa = undefined;
        }
        f.som.play(f.id);
        f.som.fade(0, f.volume, 1200, f.id);
      } else {
        f.som.fade(f.som.volume(f.id) as number, 0, 700, f.id);
        // O timer PRECISA ser cancelável. Desligar e religar o som dentro
        // de 750 ms deixava o `pause` antigo disparar em cima do som já
        // religado: áudio mudo com o botão dizendo "Som ligado".
        f.timerPausa = window.setTimeout(() => f.som.pause(f.id), 750);
      }
    }
    return this.ligado;
  }

  get ativo(): boolean {
    return this.ligado;
  }

  /**
   * O que está tocando e de onde. Serve ao painel de depuração no
   * aparelho real — "o som está ligado mas não ouço nada" é uma queixa
   * impossível de investigar sem saber posição e volume das fontes.
   */
  get diagnostico(): { url: string; pos: [number, number, number]; volume: number }[] {
    return this.fontes.map((f) => ({ url: f.url, pos: f.pos, volume: f.volume }));
  }

  /**
   * Move o ouvinte junto com a câmera. Sem isto as fontes ficam paradas
   * em relação a um ouvinte parado na origem, e o áudio "espacial" não
   * muda nada quando o usuário anda pela casa.
   */
  atualizarOuvinte(
    px: number, py: number, pz: number,
    fx: number, fy: number, fz: number,
  ): void {
    if (!this.ligado) return;
    Howler.pos(px, py, pz);
    // `up` fixo em Y+: a câmera da casa nunca inclina o horizonte.
    Howler.orientation(fx, fy, fz, 0, 1, 0);
  }

  /** Abaixa sem desligar — usado quando a apresentação começa a narrar. */
  abafar(abafado: boolean): void {
    Howler.volume(abafado ? this.mestre * 0.35 : this.mestre);
  }

  destruir(): void {
    for (const f of this.fontes) {
      f.som.unload();
      URL.revokeObjectURL(f.url);
    }
    this.fontes = [];
    this.montado = false;
    this.ligado = false;
  }
}

export const audio = new AudioManager();
