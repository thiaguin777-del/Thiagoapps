// Varredura de iluminação de interior — versão válida.
//
// A primeira versão desta varredura escreveu em A.M.estuque quando A.M
// ainda era {} (o gancho expunha um valor congelado em vez de getter), e
// eu li disso que "o IBL não afeta a parede". Afeta: com o gancho
// corrigido, envMapIntensity 0.45 -> 0.05 leva a parede de 185.7 a 62.8.
//
// Duas incógnitas de verdade:
//   1. quanto do céu a parede interna deve receber (envMapIntensity);
//   2. quanta luz de janela entra (RectAreaLight, em cd/m² desde r155 —
//      2.6 cd/m² é praticamente nada para um vão de 13 m).
//
// O estuque é o MESMO material da fachada externa, então cada caso mede
// também um enquadramento externo: baixar o interior não pode apagar a casa.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:8099/index.html?debug=1&q=high', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__AURA && window.__AURA.ready, null, { timeout: 240000 });
await page.evaluate(() => window.__AURA.renderer.setPixelRatio(1));

const ZON = {
  teto:   [0.30, 0.00, 0.70, 0.10],
  parede: [0.80, 0.20, 0.98, 0.70],
  movel:  [0.40, 0.55, 0.60, 0.75],
  piso:   [0.30, 0.85, 0.70, 0.99],
};
// Índice de capítulo é 0-based no nome do arquivo: ch04 = 'Sala de Estar',
// ch06 = 'Suíte Master'. Confundir os dois já custou um diagnóstico.
const CAMS = {
  sala:     [[-8.6, 1.6, 3.2], [-8.8, 1.15, -2.2]],
  suite:    [[6.6, 1.6, 3.4], [6.6, 1.05, -1.4]],
  fachada:  [[1, 3.0, 13.5], [-4, 2.6, 6.5]],
};

const CASOS = JSON.parse(process.env.AURA_CASOS);

for (const nomeCam in CAMS) {
  console.log(`\n############ ${nomeCam} ############`);
  console.log('   rect indoor |   teto parede  movel   piso | razão');
  for (const [rk, envEst] of CASOS) {
    const r = await page.evaluate(([cam, zon, rk, envEst]) => {
      const A = window.__AURA;
      window.__RECT_K = rk;
      // Segundo eixo agora é uIndoorMin — quanto do céu sobra no fundo do
      // cômodo. Substituiu o envMapIntensity do estuque, que era o knob
      // errado: mexia também na fachada externa, que é o MESMO material.
      A.indoor.min.value = envEst;
      A.applySolarTime(0);
      A.shot(cam[0], cam[1]);
      return A.zones(zon);
    }, [CAMS[nomeCam], ZON, rk, envEst]);
    const razao = r.parede.lum / Math.max(r.movel.lum, 0.5);
    console.log(
      `  ${String(rk).padStart(5)}  ${String(envEst).padStart(5)} | ` +
      `${String(r.teto.lum).padStart(6)} ${String(r.parede.lum).padStart(6)} ` +
      `${String(r.movel.lum).padStart(6)} ${String(r.piso.lum).padStart(6)} | ` +
      `${razao.toFixed(1)}:1`);
  }
}
await browser.close();
