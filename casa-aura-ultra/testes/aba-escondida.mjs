// ============================================================
// REGRESSAO: ABA ESCONDIDA NAO E ABA TRAVADA
// ------------------------------------------------------------
//   npm run preview                       (noutro terminal)
//   npm run teste:aba-escondida [url]
//
// Precisa de um servidor servindo o build e de um Chromium; sem GPU
// roda em SwiftShader e leva alguns minutos.
// ============================================================
//
// REPRODUZIR e depois CONFERIR o defeito do vigia de boot.
//
// Hipotese: esconder a aba durante o boot congela o rAF, o progresso
// para, e o vigia (que contava relogio de PAREDE) declarava
// 'init-travado' -- fallback TERMINAL num aparelho que estava bem.
//
// O teste esconde a aba por 40 s (PARADO_MS e 25 s) logo no comeco do
// boot, revela, e espera o boot terminar. Passa se NAO houver fallback.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const alvo = process.argv[2] || 'http://127.0.0.1:4173/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1024, height: 640 } });
const cdp = await p.context().newCDPSession(p);
const erros = [];
p.on('pageerror', (e) => erros.push(e.message.slice(0, 160)));

await p.goto(alvo + '?q=low', { waitUntil: 'domcontentloaded' });
// Deixa o boot comecar de verdade antes de esconder.
await p.waitForTimeout(6000);
const antes = await p.evaluate(() => (window.__auraTrace?.completedSteps || []).length);

console.log('escondendo a aba por 40 s (PARADO_MS = 25 s)...');
await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {});
await cdp.send('Page.setWebLifecycleState', { state: 'hidden' });
const escondida = await p.evaluate(() => document.hidden);
await p.waitForTimeout(40000);
await cdp.send('Page.setWebLifecycleState', { state: 'active' });
await p.waitForTimeout(2000);

const emFallback = async () => p.evaluate(() => {
  const antigo = document.getElementById('fallback');
  const visivel = antigo && getComputedStyle(antigo).display !== 'none';
  return document.body.dataset.estado === 'FALLBACK'
      || !!document.getElementById('fallback-rico') || !!visivel;
});
const logoApos = await emFallback();
console.log(`document.hidden durante a pausa: ${escondida}`);
console.log(`etapas antes de esconder: ${antes}`);
console.log(`FALLBACK logo apos revelar: ${logoApos}`);

// Deixa o boot terminar.
let pronto = false;
for (let i = 0; i < 80; i++) {
  await p.waitForTimeout(5000);
  if (await p.evaluate(() => (window.__auraMarcos || []).slice(-1)[0]?.etapa) === 'pronto') { pronto = true; break; }
  if (await emFallback()) break;
}
const fim = await emFallback();
console.log(`\nRESULTADO  fallback=${fim}  pronto=${pronto}  erros=${erros.length}`);
console.log(erros.length ? erros.slice(0, 3) : '');
console.log(fim ? 'FALHOU: foi para o fallback so por ter ficado escondida'
                : 'PASSOU: aba escondida nao e aba travada');
await b.close();
