// ============================================================
// BUILD AUTOCONTIDO — zero requisição externa
// ------------------------------------------------------------
// O RISCO DE NEGÓCIO que este script fecha:
//
// O arquivo de produção declara um importmap apontando para unpkg.com.
// Se o unpkg estiver fora do ar, lento, bloqueado por firewall corporativo
// ou por rede de operadora, o cliente abre o link do corretor e fica no
// loader para sempre — sem mensagem de erro, porque a falha é do módulo,
// não da cena. Este ambiente de desenvolvimento bloqueia o unpkg, o que
// significa que o caminho de produção real nunca foi exercitado aqui.
//
// A saída não é migrar para um bundler com /dist de vários arquivos: isso
// destruiria a propriedade que faz o produto funcionar comercialmente —
// UM arquivo que o corretor manda por e-mail ou WhatsApp e abre em
// qualquer lugar. A saída é embutir o three.js DENTRO do mesmo arquivo.
//
// esbuild resolve os imports contra node_modules e devolve um módulo
// único; o script troca o importmap + o <script type="module"> por esse
// bundle inline. O resultado continua sendo um HTML só, agora sem
// nenhuma dependência de rede.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const ENTRADA = process.argv[2] || resolve(RAIZ, 'CASAAURAV9.html');
const SAIDA = process.argv[3] || resolve(RAIZ, 'dist/CasaAura.html');

const html = readFileSync(ENTRADA, 'utf8');

// --- 1. recorta o script de módulo ---------------------------------
const mMod = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!mMod) { console.error('não achei o <script type="module">'); process.exit(1); }
const codigo = mMod[1];

// --- 2. bundle com esbuild -----------------------------------------
// O alias mapeia o que o importmap mapeava. Mantendo os MESMOS
// especificadores no fonte, o arquivo de produção continua legível e
// editável sem build — o build é um passo de empacotamento, não um
// requisito para trabalhar no projeto.
mkdirSync(resolve(RAIZ, 'dist'), { recursive: true });
const tmpEntrada = resolve(RAIZ, 'dist/_entrada.mjs');
const tmpSaida = resolve(RAIZ, 'dist/_bundle.mjs');
// Reescreve os especificadores para caminho absoluto em vez de usar
// --alias: o alias de "three" tambem captura "three/addons/..." e
// remapeia para dentro do arquivo three.module.js, que nao e diretorio.
const THREE_DIR = resolve(RAIZ, '.devtest/node_modules/three');
const codigoResolvido = codigo
  .replace(/from ['"]three\/addons\//g, `from '${THREE_DIR}/examples/jsm/`)
  .replace(/from ['"]three['"]/g, `from '${THREE_DIR}/build/three.module.js'`);
writeFileSync(tmpEntrada, codigoResolvido);

const esbuild = resolve(RAIZ, '.devtest/node_modules/.bin/esbuild');
execFileSync(esbuild, [
  tmpEntrada,
  '--bundle',
  '--format=esm',
  '--target=es2020',
  '--minify',
  '--legal-comments=none',
  `--outfile=${tmpSaida}`,
], { stdio: ['ignore', 'inherit', 'inherit'] });

const bundle = readFileSync(tmpSaida, 'utf8');

// --- 3. costura de volta -------------------------------------------
// Fora o importmap (não há mais nada para mapear) e dentro o bundle, no
// lugar exato onde o módulo estava — a ordem de execução em relação ao
// resto da página não muda.
// A substituição usa FUNÇÃO, não string.
//
// String.replace com string de substituição interpreta $&, $`, $', $1…
// como referências ao casamento. Um bundle minificado de 1 MB está cheio
// de `$` seguido de qualquer coisa, então pedaços do próprio HTML eram
// injetados no meio do JavaScript. O sintoma no navegador era
// "Unexpected token '<'" — o módulo inteiro deixava de parsear e a cena
// nunca subia, com o loader parado em 0%. Só apareceu porque o arquivo
// de produção foi carregado de verdade com a rede bloqueada.
//
// A função de substituição recebe o texto e devolve o texto, sem
// interpretar nada.
const bundleSeguro = bundle
  // Um "</script>" dentro de string no bundle fecharia a tag mais cedo.
  // Quebrar a sequência é inócuo para o JS e salva o HTML.
  .replace(/<\/script>/gi, '<\\/script>');
let saida = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, () => '')
  .replace(/<script type="module">[\s\S]*?<\/script>/,
    () => '<script type="module">\n' + bundleSeguro + '\n</script>');

// --- 4. prova ------------------------------------------------------
// Falhar o build é melhor que descobrir em produção. Qualquer URL http(s)
// que sobre em posição de carregamento derruba o build.
// Só conta o que a PÁGINA CARREGA. Um <a href> para wa.me é o CTA que o
// cliente clica — se o WhatsApp estiver fora, o link não abre e mais
// nada acontece; a cena já está na tela. Confundir os dois faria o build
// recusar por um link que não é dependência.
const porScript = [...saida.matchAll(/<script[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/g)].map(m => m[1]);
const porLink = [...saida.matchAll(/<link[^>]+href\s*=\s*["'](https?:\/\/[^"']+)/g)].map(m => m[1]);
const porImport = [...saida.matchAll(/(?:from|import)\s*\(?\s*["'](https?:\/\/[^"']+)/g)].map(m => m[1]);
const porImportmap = /<script type="importmap">/.test(saida) ? ['(importmap ainda presente)'] : [];
const todos = [...new Set([...porScript, ...porLink, ...porImport, ...porImportmap])]
  // Google Fonts é folha de estilo opcional e degrada sozinha; o que não
  // pode faltar é o motor 3D.
  .filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u));
if (todos.length) {
  console.error('BUILD RECUSADO — sobraram dependências externas:');
  todos.forEach(u => console.error('   ' + u));
  process.exit(1);
}

writeFileSync(SAIDA, saida);
const kb = (Buffer.byteLength(saida) / 1024).toFixed(0);
console.log(`autocontido: ${SAIDA}  ${kb} KB  (bundle ${(Buffer.byteLength(bundle) / 1024).toFixed(0)} KB)`);
console.log('requisições externas obrigatórias: 0');
