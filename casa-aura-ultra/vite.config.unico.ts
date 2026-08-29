import { defineConfig } from 'vite';

// Build de ARQUIVO ÚNICO — para entregar a experiência como um .html que
// abre com duplo clique, sem servidor.
//
// Por que separado do `vite.config.ts` de produção, e não uma flag nele:
// as duas configurações querem coisas opostas. A de produção divide o
// three.js num chunk próprio justamente para o segundo acesso do corretor
// baixar só o que mudou; esta junta tudo num arquivo só, que é o oposto
// de cache eficiente — mas é o único formato que roda sem servidor.
// Manter as duas separadas evita que uma regrida a outra.
//
// `inlineDynamicImports` é obrigatório aqui: a aplicação carrega
// three/gsap/howler e os módulos de UI por import dinâmico, e um import
// dinâmico continua sendo um FETCH — de um arquivo que, em `file://`, não
// existe mais. Sem isto o HTML abre e fica parado no loader.
export default defineConfig({
  build: {
    target: 'es2020',
    assetsInlineLimit: 100000000,   // nada de arquivo à parte
    sourcemap: false,
    cssCodeSplit: false,
    outDir: 'dist-unico',
    rollupOptions: {
      output: {
        // `iife`, e NÃO módulo. Medido abrindo o arquivo: o Chrome
        // bloqueia ES modules em `file://` — a origem é opaca e o
        // carregamento de módulo falha por CORS, inclusive para script
        // INLINE. O sintoma é cruel: página branca, loader parado,
        // `window.__auraCena` indefinido e NENHUM erro visível, porque o
        // bloqueio acontece antes de qualquer código nosso rodar.
        // Bundle clássico executa.
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
    chunkSizeWarningLimit: 4000,
  },
});
