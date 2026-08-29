// Costura o build de arquivo único num só .html, que abre com duplo
// clique — sem servidor, sem pasta de assets, sem instalação.
//
// O que precisa ser tratado, e por quê:
//
//  - <script src> e <link rel=stylesheet> viram conteúdo embutido. Num
//    `file://` qualquer caminho absoluto (`/app.js`) aponta para a RAIZ
//    DO DISCO, então referência externa simplesmente não carrega.
//  - o manifest e o service worker saem. Ambos exigem origem http(s);
//    em `file://` o registro do SW lança e sujaria o console logo na
//    abertura, num arquivo cujo propósito é ser aberto e funcionar.
//  - a fonte do Google fica, com fallback: se houver rede ela entra, se
//    não houver o CSS já degrada para a pilha de sistema.
//
// A troca `</script>` -> `<\/script>` no JS embutido não é frescura: o
// parser de HTML fecha o bloco no primeiro `</script>` LITERAL que
// encontrar, mesmo dentro de uma string JavaScript. Sem escapar, um
// shader ou um comentário que contenha esse texto corta o arquivo ao
// meio.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(raiz, 'dist-unico');
const saida = process.argv[2] || resolve(raiz, 'casa-aura.html');

let html = readFileSync(resolve(dir, 'index.html'), 'utf8');
const js = readFileSync(resolve(dir, 'app.js'), 'utf8');
const css = readFileSync(resolve(dir, 'app.css'), 'utf8');

// A ORDEM IMPORTA, e errar custou um ciclo: se o bundle for embutido
// ANTES da limpeza, o regex que tira o registro do service worker casa
// com o `<script>` recém-criado (o bundle menciona `serviceWorker` em
// algum ponto) e apaga 1,3 MB de aplicação. O sintoma foi um arquivo de
// 30 kB que passava em todas as conferências. Limpar primeiro, embutir
// depois.
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');
html = html.replace(/<link rel="icon"[^>]*>\s*/g, '');
html = html.replace(/<script>[^<]*serviceWorker[\s\S]*?<\/script>\s*/g, '');

// Sem `type="module"`: o Chrome bloqueia módulo em `file://` (origem
// opaca), e o bloqueio acontece antes de qualquer código nosso rodar —
// página branca e nenhum erro. O build de arquivo único sai em `iife`
// justamente para poder entrar como script clássico.
//
// E vai para o FIM DO BODY, não para o lugar onde estava a tag original.
// Módulo é adiado por padrão; script clássico não, e `defer` não vale
// para script embutido. No `<head>` ele roda antes de o `<body>` existir
// e a aplicação morre no primeiro `appendChild` com "Cannot read
// properties of null" — que foi exatamente o que aconteceu.
html = html.replace(/<script[^>]*src="\/app\.js"[^>]*><\/script>\s*/, '');
html = html.replace(
  /<\/body>/,
  `<script>\n${js.replace(/<\/script>/g, '<\\/script>')}\n</script>\n</body>`,
);
html = html.replace(
  /<link rel="stylesheet"[^>]*href="\/app\.css"[^>]*>/,
  `<style>\n${css}\n</style>`,
);

// A conferência tem de olhar só o MARCADOR. Rodada sobre o arquivo
// inteiro ela acusa `href="/..."` que vive dentro de uma string do
// bundle — texto de dado, não referência que o navegador vá buscar.
const soMarcacao = html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '');
const sobrou = [...soMarcacao.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
if (sobrou.length) {
  console.error('AINDA HA REFERENCIA ABSOLUTA (nao vai abrir em file://):', sobrou);
  process.exit(1);
}
writeFileSync(saida, html);
console.log(`${saida}  ${(html.length / 1048576).toFixed(2)} MB`);
