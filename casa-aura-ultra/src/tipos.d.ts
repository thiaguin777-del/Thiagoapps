// Declaracoes para imports que o bundler resolve mas o TS nao conhece.
//
// Os shaders entram por `?raw`, recurso nativo do Vite — sem plugin. Ver a
// nota em vite.config.ts sobre por que o vite-plugin-glsl saiu.
declare module '*.glsl?raw' { const s: string; export default s; }
declare module '*.vert?raw' { const s: string; export default s; }
declare module '*.frag?raw' { const s: string; export default s; }
