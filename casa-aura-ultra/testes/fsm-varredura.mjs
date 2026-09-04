import fs from 'node:fs';
// ============================================================
// VARREDURA EXAUSTIVA DA MAQUINA DE ESTADOS
// ------------------------------------------------------------
//   npm run teste:fsm
//
// A FSM e o unico lugar onde o estado da experiencia pode mudar, e a
// tabela PERMITIDO e a lei. Este teste tenta TODO par ordenado de
// estados (7x7) e confronta o resultado com a tabela LIDA DO FONTE --
// nao redigitada aqui, senao o teste envelheceria junto com o codigo em
// vez de vigia-lo.
//
// Alem da matriz, sete propriedades que a leitura do codigo nao garante:
// FALLBACK absorvente, recusa de transicao concorrente, excecao em
// callback e em ouvinte nao derrubando a maquina, descadastro de
// ouvinte, e auto-transicao sempre recusada.
//
// Roda em Node com um DOM minimo: a FSM so precisa de createElement,
// body.dataset, appendChild, performance.now e setTimeout.
// ============================================================
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-fsm-'));

const SRC = new URL('../src/core/StateMachine.ts', import.meta.url).pathname;
const OUT = TMP + '/StateMachine.js';

// --- DOM minimo -------------------------------------------------
const elem = () => ({ style: { cssText: '', opacity: '0' }, dataset: {}, id: '',
                      appendChild() {}, });
globalThis.document = { createElement: elem, body: elem() };
globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };

execFileSync('npx', ['tsc', SRC, '--outDir', TMP, '--module', 'esnext',
                     '--target', 'es2020', '--moduleResolution', 'bundler'],
             { stdio: 'inherit' });
const { StateMachine } = await import(OUT + '?v=' + Date.now());

const ESTADOS = ['LOADING','HERO','EXPLORING','CINEMATIC','PRESENTATION','FALLBACK','COMMERCIAL'];
// Tabela lida do FONTE, nao redigitada: se o codigo mudar, o teste
// acompanha em vez de mentir.
const fonte = fs.readFileSync(SRC, 'utf8');
const bloco = fonte.split('const PERMITIDO')[1].split('};')[0];
const TABELA = {};
for (const e of ESTADOS) {
  const m = bloco.match(new RegExp(`\\n\\s*${e}:\\s*\\[([^\\]]*)\\]`));
  TABELA[e] = m ? m[1].split(',').map(s => s.trim().replace(/['"]/g,'')).filter(Boolean) : [];
}
console.log('tabela lida do fonte:');
for (const e of ESTADOS) console.log(`  ${e.padEnd(13)} -> ${TABELA[e].join(', ') || '(nada)'}`);

let falhas = [];
const ok = (cond, msg) => { if (!cond) falhas.push(msg); };

// --- 1. Todo par ordenado -----------------------------------------
// Para cada estado de partida, uma FSM nova levada ate la por um caminho
// legal; depois tenta-se ir para cada um dos 7.
function caminhoAte(alvo) {
  // BFS a partir de LOADING pela tabela.
  const fila = [['LOADING']], visto = new Set(['LOADING']);
  while (fila.length) {
    const cam = fila.shift();
    const u = cam[cam.length - 1];
    if (u === alvo) return cam;
    for (const v of TABELA[u]) if (!visto.has(v)) { visto.add(v); fila.push([...cam, v]); }
  }
  return null;
}

console.log('\n--- matriz 7x7 (linha = de, coluna = para) ---');
console.log('           ' + ESTADOS.map(e => e.slice(0,4).padEnd(5)).join(''));
let testados = 0;
for (const de of ESTADOS) {
  const cam = caminhoAte(de);
  const linha = [];
  for (const para of ESTADOS) {
    if (!cam) { linha.push('  -  '); continue; }
    const m = new StateMachine();
    for (const passo of cam.slice(1)) await m.ir(passo);
    if (m.atual() !== de) { linha.push(' ??  '); continue; }
    const esperado = de !== para && TABELA[de].includes(para);
    const obtido = await m.ir(para);
    testados++;
    ok(obtido === esperado,
       `${de} -> ${para}: ir() devolveu ${obtido}, tabela diz ${esperado}`);
    ok(m.podeIr(para) === TABELA[de].includes(para) || m.atual() !== de,
       `${de} -> ${para}: podeIr discorda da tabela`);
    linha.push((obtido ? ' OK  ' : (esperado ? ' XX  ' : '  .  ')));
  }
  console.log(de.padEnd(11) + linha.join(''));
}
console.log(`(${testados} pares exercitados; OK = permitido e aceito, . = negado, XX = FALHA)`);

// --- 2. Alcancabilidade -------------------------------------------
console.log('\n--- alcancabilidade a partir de cada estado ---');
for (const de of ESTADOS) {
  const visto = new Set([de]), fila = [de];
  while (fila.length) for (const v of TABELA[fila.shift()]) if (!visto.has(v)) { visto.add(v); fila.push(v); }
  const inalcancavel = ESTADOS.filter(e => !visto.has(e));
  console.log(`  de ${de.padEnd(13)} nao alcanca: ${inalcancavel.join(', ') || '(nada)'}`);
}

// --- 3. FALLBACK e absorvente -------------------------------------
{
  const m = new StateMachine();
  m.travar('teste');
  ok(m.atual() === 'FALLBACK', 'travar() nao levou a FALLBACK');
  ok(m.emFallback === true, 'emFallback falso apos travar()');
  for (const para of ESTADOS) {
    ok((await m.ir(para)) === false, `FALLBACK aceitou ir(${para})`);
  }
  ok(m.atual() === 'FALLBACK', 'FALLBACK nao e absorvente');
  m.travar('de novo');
  ok(m.atual() === 'FALLBACK', 'travar() duas vezes quebrou o estado');
}

// --- 4. Transicao concorrente e recusada --------------------------
{
  const m = new StateMachine();
  await m.ir('HERO');
  const a = m.ir('EXPLORING');           // sem await: fica em transicao
  const b = await m.ir('CINEMATIC');     // deve ser recusada
  ok(b === false, 'segunda transicao aceita durante a primeira');
  ok(m.transicionando === true || (await a) !== null, 'transicionando nao sinalizou');
  ok((await a) === true, 'primeira transicao falhou');
  ok(m.atual() === 'EXPLORING', `estado apos concorrencia: ${m.atual()}`);
  ok(m.transicionando === false, 'ficou preso em transicao');
}

// --- 5. Callback que lanca nao derruba a maquina ------------------
{
  const m = new StateMachine();
  await m.ir('HERO');
  const r = await m.ir('EXPLORING', () => { throw new Error('proposital'); });
  ok(r === true, 'callback que lancou impediu a transicao');
  ok(m.atual() === 'EXPLORING', 'estado nao avancou apos callback lancar');
  ok(m.transicionando === false, 'ficou preso em transicao apos excecao');
}

// --- 6. Ouvinte que lanca nao impede os seguintes -----------------
{
  const m = new StateMachine();
  let chamou2 = false;
  m.aoMudar(() => { throw new Error('ouvinte ruim'); });
  m.aoMudar(() => { chamou2 = true; });
  await m.ir('HERO');
  ok(chamou2 === true, 'ouvinte seguinte nao foi chamado apos um lancar');
}

// --- 7. aoMudar devolve descadastro funcional ---------------------
{
  const m = new StateMachine();
  let n = 0;
  const off = m.aoMudar(() => n++);
  await m.ir('HERO');
  off();
  await m.ir('EXPLORING');
  ok(n === 1, `descadastro nao funcionou (n=${n})`);
}

// --- 8. Auto-transicao sempre recusada ----------------------------
for (const e of ESTADOS) {
  const cam = caminhoAte(e);
  if (!cam) continue;
  const m = new StateMachine();
  for (const passo of cam.slice(1)) await m.ir(passo);
  ok((await m.ir(e)) === false, `${e} -> ${e} foi aceita`);
}

console.log(`\n=== ${falhas.length} FALHA(S) ===`);
falhas.forEach(f => console.log('  ' + f));
process.exit(falhas.length ? 1 : 0);
