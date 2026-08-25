import { defineConfig } from 'vite';

// Casa Aura Ultra — configuração de build.
//
// Duas decisões que vêm de medição na versão anterior do projeto, não de
// preferência:
//
// 1. `assetsInlineLimit: 0`. O experiência carrega texturas e modelos
//    grandes; deixar o Vite embutir alguns como base64 e outros não torna
//    o cache imprevisível — e cache previsível é o que faz o segundo
//    acesso do corretor ser instantâneo.
// 2. `target: 'es2020'`. Safari do iPad de 2020 é o piso real do parque
//    de aparelhos deste produto.
export default defineConfig({
  // Sem vite-plugin-glsl DE PROPOSITO.
  //
  // Ele foi instalado primeiro e transformou TODO ARQUIVO .ts do projeto
  // em uma string exportada — o main.ts chegava ao navegador como
  // `var main_default = "import ..."`, nada executava, e o loader ficava
  // parado em 0% sem um unico erro no console. Custou um ciclo inteiro de
  // teste para achar, porque a pagina respondia 200 em tudo.
  //
  // O Vite ja importa arquivo cru com o sufixo `?raw`, que e o que os
  // shaders precisam. Uma dependencia a menos e nenhum plugin mexendo no
  // pipeline dos .ts:
  //     import agua from '../shaders/water.frag?raw';
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: true,
    rollupOptions: {
      output: {
        // Separa o three.js do código da aplicação: o motor muda de versão
        // raramente e a cena muda toda semana. Em cache separado, quem já
        // visitou baixa só a parte que mudou.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/gsap')) return 'gsap';
          if (id.includes('node_modules/howler')) return 'howler';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
