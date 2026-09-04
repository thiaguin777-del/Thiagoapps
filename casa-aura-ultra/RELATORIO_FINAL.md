# Relatório final — fechamento de produção, Casa Aura

Cada item aqui foi executado neste repositório e tem número, ou está
marcado como não tendo. Nenhuma afirmação de "sem bugs", "60 FPS" ou
"perfeito" aparece neste documento; a razão está na seção 9.

---

## 1. Baseline

### Ambiente

| item | valor |
|---|---|
| Node | v22.22.2 |
| npm | 10.9.7 |
| SO | Linux 6.18.44 |
| Vite | 5.4.21 |
| three.js | 0.160.1 |
| GSAP 3.12.5 · Howler 2.2.4 · TypeScript 5.4.5 | |
| **GPU** | **nenhuma** — Chromium com SwiftShader, ~0,1 quadro/s |

### Comandos

| comando | tempo | resultado |
|---|---|---|
| `npm ci` | 4,9 s | 22 pacotes |
| `npm run typecheck` | 1,5 s | sem erro |
| `npm run build` | 3,6 s | sem erro |
| `npm run build:unico` | 3,5 s | sem erro |

### Bundles

| arquivo | bruto | gzip |
|---|---|---|
| `three` | 1 074,38 kB | 348,47 kB |
| `cena-bruta` | 113,23 kB | 40,53 kB |
| `gsap` | 70,49 kB | 27,84 kB |
| `howler` | 36,58 kB | 9,92 kB |
| `CasaAuraScene` | 27,46 kB | 10,46 kB |
| `index` | 14,55 kB | 5,72 kB |

19 chunks JS · `dist` 6 520 454 bytes com sourcemaps.

### Artefatos e hashes

| arquivo | bytes | SHA-256 (16 primeiros) |
|---|---|---|
| `casa-aura.html` | 1 412 117 | `0535fa5b347b2222…` |
| `casa-aura-fonte.zip` | 273 798 | `236e11548a2392d4…` |
| `dist/index.html` | 8 878 | `3389c09ccf455eae…` |

### Vulnerabilidades

`npm audit`: 2 (1 moderada, 1 alta), **as duas em `vite`/`esbuild`**, que
são `devDependencies`. Afetam o servidor de desenvolvimento, **não o
artefato publicado** — o build é HTML/JS estático. Mitigação: não expor o
dev server. Correção definitiva exige subir major do Vite, o que não é
mudança para uma rodada de fechamento.

### Referências no artefato

**Antes: 3 de 6 davam 404** — `/favicon.ico`, `og:image` e os dois ícones
PNG do manifesto não existiam. **Agora: 4 de 4 resolvem.** Favicon virou
`favicon.svg` (marca em path, sem depender de fonte), o manifesto aponta
para ele, e a tag `og:image` foi **removida**: card social quebrado é
pior que nenhum, e não há captura aprovada para o lugar.

### Assets

**Zero presentes, 35 referenciados.** Isto **não é erro**: a cena roda
inteira no procedural e sonda a presença antes de tentar carregar. Ver
`MANIFESTO_ASSETS.md`.

---

## 2. Boot e fallback — matriz executada

Nove cenários. A asserção central é uma só: **cena pronta ou fallback
útil, nunca barra parada para sempre.**

| cenário | tempo | desfecho | `dataset.estado` | loader | erros |
|---|---|---|---|---|---|
| origem HTTP | 416 s | **pronto** | HERO | oculto | 0 |
| `file://` | 82 s | **pronto** | HERO | oculto | 0 |
| aba oculta (rAF morto) | 43 s | **fallback** | FALLBACK | oculto | 0 |
| sem WebGL | 18 s | **fallback** | FALLBACK | oculto | 1 |
| contexto recusado | 18 s | **fallback** | FALLBACK | oculto | 1 |
| rede bloqueada | 264 s | **pronto** | HERO | oculto | 1 |
| viewport 360×640 | 96 s | **pronto** | HERO | oculto | 0 |
| retorno do background | 343 s | **fallback** | FALLBACK | oculto | 0 |
| efeito quebrado | 282 s | **pronto** | HERO | oculto | 1 |

Os tempos altos são desta máquina sem GPU com processos concorrentes.
**Não são tempo de boot em hardware real** — ver seção 9.

### Três defeitos que a matriz encontrou

**1. O watchdog de 20 s matava cenas saudáveis.** Era
`setTimeout(20000)`, e `showFallback` desliga `renderLoopActive` de forma
definitiva. O boot normal levou 416 s e teria sido morto aos 20 s,
estando saudável. Num celular médio, com a geração procedural desta cena,
20 s é um teto plausível de encostar. **Corrigido:** detecta *travamento*
(25 s sem concluir etapa) e não lentidão, com teto absoluto de 180 s.

**2. Um efeito que estoura matava o laço de render para sempre.**
`renderer.setAnimationLoop` agenda o quadro seguinte **depois** de chamar
o callback: uma exceção em qualquer gancho impedia o agendamento e
congelava a tela sem erro visível. **Corrigido:** `rodarGanchos` isola
cada chamada e remove o gancho que falha. Verificado — o cenário agora
chega a `pronto` com `[antes-do-quadro] gancho 0 falhou e foi removido`.

**3. O fallback convivia com uma cena viva.** Medido `pronto=true` **e**
`fallback=true` no mesmo boot, `dataset.estado` em HERO: dois donos no
mesmo atributo. **Corrigido:** `FALLBACK` entrou no tipo `Estado` como
terminal e `fsm.travar()` fecha a máquina antes de montar o fallback.

### O "defeito aberto" era outro defeito

A rodada anterior registrou: *"retorno do background não recupera —
quem abre o link numa aba de fundo cai no fallback e continua nele ao
voltar"*, e propôs recuperação como conserto.

A pergunta estava errada. **Não era como recuperar: era por que tinha
ido para lá.**

O vigia de boot já tinha sido consertado uma vez, trocando "demorou 20 s"
por "parou de progredir" — a pergunta certa. Mas o relógio continuou
sendo o de **parede**. Uma aba escondida congela o `requestAnimationFrame`
(o navegador economizando bateria, não a cena travando), enquanto o
`setInterval` do vigia segue rodando afunilado. Trocar de aba por 25 s
durante o boot mandava para o fallback um aparelho perfeitamente saudável
— e o fallback é terminal por projeto.

Agora o tempo escondido é **descontado**, ancorado no instante do último
progresso (não somado no total, senão o crédito de uma pausa antiga
pagaria por um travamento de agora).

`testes/aba-escondida.mjs` (`npm run teste:aba-escondida`) reproduz o
cenário: esconde a aba por 40 s durante o boot e falha se cair no
fallback. `UNTESTED` — escrito, ainda não executado até o fim nesta
máquina, onde um boot custa cerca de dez minutos.

---

## 4. Proteção de apresentação — três tiers

O `QualityController` degrada por degraus e resolve o aparelho que está
*quase* dando conta. Não resolve o que não vai dar conta, e ali insistir
entrega engasgo na frente de um cliente.

| tier | quando | o que fica ligado |
|---|---|---|
| `REALTIME` | GPU reconhecida | tudo |
| `COMPATIBILITY` | **padrão para hardware desconhecido** | DPR 0,6; sem sombra, GTAO, bloom, DOF, partícula, volumetria, água animada nem transmissão; tone mapping Reinhard |
| `PRESENTATION_SAFE` | 4 s abaixo de 15 fps, ou renderizador por software | **sem 3D**; jornada comercial por renders reais da própria cena |

- Sonda: `WEBGL_debug_renderer_info` quando disponível, memória, núcleos,
  DPR, viewport, WebGL2. A string da GPU é **pista, não verdade** — sem
  ela a resposta é COMPATIBILITY, nunca um chute otimista.
- Janela de 2 s, com 1,5 s de aquecimento descartado (ali há compilação
  de shader; medir isso seria medir o boot). Mediana < 24 fps **ou**
  p95 > 55 ms degrada um degrau.
- Toda transição carrega **ficha de cancelamento**; uma nova invalida as
  pendentes. Nenhum timer do modo seguro sobrevive à saída.
- O laço **dorme** em três situações: aba oculta, painel comercial aberto
  e modo seguro.
- Relatório em `?debug=1`: tier, motivo da troca, degrau, FPS e tempo de
  quadro em p50/p95/p99 e pior, draws, triângulos, programas, DPR,
  renderer, vendor, WebGL2, memória, núcleos, viewport. Sem amostras
  suficientes, os campos dizem `UNMEASURED`.

O `PRESENTATION_SAFE` entrega a **mesma jornada**: capítulos navegáveis,
modo cinemático (avanço automático cancelável), planos e WhatsApp. Setas
do teclado navegam, `Escape` para o cinemático, foco visível, alvos de
toque de 48 px em ponteiro grosso, e `aria-live` na legenda.

---

## 5. Rodada visual — capturas observadas

Sete capturas geradas da cena e **efetivamente inspecionadas**. Nenhuma
afirmação visual aqui vem de inferência geométrica.

### O instrumento foi consertado antes das imagens

Duas rodadas de capturas foram invalidadas por erro meu, não do produto,
e vale registrar porque o mesmo erro aparecia de forma diferente cada vez:

1. **Câmera setada à mão para dentro do envelope** — `clampFreeCamera` a
   expulsou, que é o guarda anti-clip funcionando. Resolvido entrando
   pelo caminho do produto (`Experience.set('presenting')`).
2. **`?tier=REALTIME` não era autoridade** — o governador rebaixava para
   `PRESENTATION_SAFE` no meio da corrida, e duas capturas saíram do
   overlay do modo seguro em vez da cena. Os dois arquivos tinham
   exatamente 769.727 bytes: a mesma imagem. Corrigido com uma trava,
   espelhando a que o `?q=` já tinha.
3. **Coordenadas chutadas** — a "suíte" saiu a 4,3 m de altura, um
   pavimento acima e do lado de fora do muro, olhando a mata. A câmera
   obedeceu (`erro = 0`): o errado era o pedido. As horas também estavam
   erradas (`t=0` é meio-dia, não `0,30`).

A galeria agora é capturada pelas **câmeras do próprio produto**
(`src/data/chapters.json`) e pelas **paradas solares do próprio código**
(`SOLAR_T`), não por números meus. `erro = 0` em todas as sete.

### O preto absoluto: da suspeita à medição

O defeito era descrito na rodada anterior como "25–35% do quadro em preto
absoluto na golden hour", a olho. O histograma deu o número e apontou o
lado errado da curva:

| captura | estourado (≥250 RGB) | preto absoluto (L≤4) |
|---|---|---|
| exterior dia | 0,00% | 3,44% |
| interior estar | 0,00% | 3,08% |
| golden terraço | 0,00% | **26,56%** |
| exterior noite | 0,00% | **43,17%** |

Eu tinha lido "chão estourado" na mesma imagem. **Zero por cento** dos
pixels estavam em ≥250 nos três canais. O defeito estava todo na sombra.

A causa foi encontrada por **ablação** — um boot, seis variantes do mesmo
quadro (capítulo 8), com os passes de pós expostos por `passesDePos()`:

| variante | preto absoluto | conclusão |
|---|---|---|
| base | 20,34% | — |
| sem vinheta | 20,28% | **não é ela** (hipótese minha, morta) |
| sem grão | 21,08% | o grão até **ajudava** |
| sem GTAO | 20,44% | não é ele |
| sem bloom | 23,95% | o bloom **ajudava** |
| `lift = 0,20` | **0,00%**, p1 = 36 | é o lift |

O `lift` rodava **antes** do contraste, que o anulava. Invertido, ainda
passava raspando: com contraste 1,092, `c=0 → −0,046 → −0,0056 → clamp →
0`. Faltavam seis milésimos. Um `clamp` entre os dois faz o piso ser
igual ao `lift` para qualquer contraste — garantia, não coincidência.

### Antes e depois, mesma câmera e mesma hora

| captura | antes | depois | p1 depois |
|---|---|---|---|
| exterior dia | 3,44% | 0,58% | 6 |
| interior estar | 3,08% | 0,58% | 11 |
| **golden terraço** | **22,02%** | **0,00%** | 6 |
| suíte master | — | 0,56% | 10 |
| piscina golden | — | 0,00% | 6 |
| cozinha | — | 0,00% | 7 |
| **exterior noite** | **35,34%** | **0,00%** | 10 |

**Ressalva honesta:** o defeito *técnico* fechou — não há mais informação
cortada irrecuperavelmente. O defeito *perceptual* não fechou por
completo: o piso do terraço e o deck da piscina continuam lendo como
vazio, agora em 6–8/255 em vez de 0. Ver "Defeitos visuais" abaixo.

### Confirmações positivas, com imagem

| item | veredito |
|---|---|
| Gramado sem z-fighting | `VISUAL VERIFIED` |
| Mata distante assentada no relevo | `VISUAL VERIFIED` |
| Colina de fundo escurece à noite | `VISUAL VERIFIED` — silhueta azul-escura, era verde clara |
| Poeira fora dos interiores | `VISUAL VERIFIED` — cozinha no golden hour, o quadro que a expôs, agora limpo |
| Suíte master pela câmera do produto | `VISUAL VERIFIED` — render vendável |
| Piscina à noite | `VISUAL VERIFIED` — lâmina translúcida, LED de borda, fundo visível |

### A poeira: por que foi desligada e não recalibrada

Duas rodadas de conserto, duas capturas de apresentação estragadas.
A conta encerra o assunto. No pico de Mie, em blending aditivo, uma
partícula soma `0,22 × (255,242,220)` = **+56 níveis**:

- sobre parede ensolarada (200/255) → **+28%**, ponto branco cravado
- para ficar sob o limiar de Weber (~1%) ali → opacidade ≤ **0,008**
- nesse valor, sobre sombra (30/255) → **+2 níveis**, invisível

Não existe opacidade constante que apareça na sombra e suma na luz.
Poeira real é invisível contra parede iluminada porque tem a luminância
do fundo — e um passe aditivo adiante **não conhece o fundo**. O modelo
está errado por construção, não mal calibrado. Corrigir exige amostrar
profundidade da cena atrás da partícula. Fica atrás de `?poeira=1`.

### Defeitos visuais

| # | defeito | estado |
|---|---|---|
| A | Colina de fundo verde e clara à noite | **CORRIGIDO**, `VISUAL VERIFIED` |
| B | Preto absoluto em golden hour e noite | **CORRIGIDO** — 22,02%→0,00% e 35,34%→0,00% |
| C | Poeira lendo como sujeira de lente | **CORRIGIDO** — desligada, com a conta que justifica |
| D | Folhagem verde e iluminada à noite | **corrigido**, recaptura pendente |
| E | Deck e piso de terraço lendo como vazio no golden hour | `ABERTO` — ver abaixo |
| F | Piscina verde-musgo e opaca no golden hour | `ABERTO` — mesma causa que E |
| G | Tiling visível da textura de grama | `ABERTO` |
| H | Copas próximas leem como massa de cartões | `ABERTO` |

**Sobre F, a piscina.** Cinco rodadas de diagnóstico, e o resultado é uma
caracterização precisa em vez de um conserto. Vale registrar o caminho
porque **três hipóteses minhas morreram na medição**, incluindo uma que
eu já tinha escrito neste relatório.

Mesma câmera (capítulo 9), mesmo material, só a hora muda:

| hora | como lê |
|---|---|
| dia (`t=0`) | turquesa, translúcida, ladrilho do fundo visível **através** da água, deck de ipê marrom quente. **Vendável.** |
| golden (`t=0,52`) | verde-musgo e opaca, deck preto |
| blue (`t=0,76`) | retângulo **preto**, só a fita de LED |
| noite (`t=1,0`) | idem |

**Correção de uma afirmação minha anterior:** eu tinha registrado que a
piscina "lê certo à noite". Aquilo veio do plano distante do capítulo 13,
onde a superfície reflete o céu. De perto, à noite, ela é preta.

O que foi **descartado por medição**, não por opinião:

| hipótese | teste | resultado |
|---|---|---|
| Material da água errado | mesma água às 4 horas | no dia está correta — não é o material |
| A água opaca esconde o fundo | `waterObj.visible = false` | bacia **continua preta** |
| O emissivo do revestimento não é aplicado | leitura do material nas 4 horas | é aplicado: `0,35 → 1,04 → 1,50 → 2,19`, e as bordas **respondem** a ele |
| Faces internas descartadas (`FrontSide`) | `side = DoubleSide` em execução | **sem efeito** |
| Emissivo fraco demais | intensidade 6,0 + marcador magenta | só as bordas externas ficam magenta; o interior **não** |

O que **está estabelecido**: existe **uma** malha com `M.revestPiscina`
(piso e paredes foram mesclados), sua caixa cobre a bacia
(`x[-10,8; -0,4] z[7,8; 13,0] y[-1,80; 0,06]`), ela está visível — e
mesmo assim o interior da bacia não aparece com nenhum valor de `side`,
nenhuma intensidade de emissivo, com ou sem água. **Algo oclui a bacia.**

Não consegui identificar o quê, e a razão é honesta: as ferramentas de
caixa envelopante não servem aqui. A cena mescla geometria por material,
e a AABB de uma malha mesclada cobre o lote inteiro — o levantamento de
candidatos a oclusão devolveu 23 malhas, a maior com **810.000 m²** de
área em planta. Este mesmo obstáculo já custou duas rodadas neste
projeto. Responder exige sonda de profundidade real (ler o depth buffer
ou um raycast por triângulo), que é plumbing de composer.

Próximo passo para quem pegar: suspeitar do deck não perfurado na
abertura da piscina, e confirmar lendo profundidade, não caixas.

**Sobre E, o deck e o piso do terraço.** Causa diferente e mais simples:
com o sol a 11° de elevação, superfície voltada para cima recebe
`sin(11°) = 0,19` da luz direta, contra `cos(11°) = 0,98` de uma parede
virada para o sol. Na sombra da casa sobra a hemisférica (0,28) sobre
albedo baixo. É **fisicamente correto e comercialmente ruim**: a legenda
do capítulo 9 vende "borda infinita, deck em ipê e área gourmet coberta",
e no golden hour nenhum dos três aparece.

### Observação de direção de arte, não defeito

O capítulo 5 ("Sala de Estar") tem a legenda *"Ambiente social integrado,
voltado para a piscina"* e a câmera olha para a parede da TV, com o vidro
atrás dela. O cômodo **é** orientado para a piscina — só o enquadramento
não mostra. Não mexi na sua câmera autoral; fica registrado para você
decidir.

---

## 7. Conversão

### O defeito comercial

Havia **três implementações independentes** do número de WhatsApp:

| origem | lia | sem número |
|---|---|---|
| `wireWhatsappCTA` (legado) | `CONFIG` ou `?wa=` | esconde o botão |
| `abrirWhatsApp` (Commercial) | global ou `?wa=` | **`return` silencioso** |
| `Fallback` | só `?wa=` | remove o link |

Configurar por `CONFIG.whatsappThiago` acendia o CTA do herói e deixava
os **três botões de plano mortos com cara de funcionais**. A global fazia
o inverso. Só `?wa=` acertava os três — justamente o caminho que não se
usa ao publicar. **Corrigido:** `src/core/Contato.ts` é a fonte única.

### A armadilha do código de país

`wa.me` lê os primeiros dígitos como **código de país**. `61993666859`,
escrito como todo brasileiro escreve, seria lido como **Austrália** —
link válido, botão funcional, conversa no lugar errado. O código
normaliza (10–11 dígitos com DDD 11–99 recebem `55`) e avisa no console.

### Verificado

| configuração | CTA herói | CTAs de plano |
|---|---|---|
| nenhuma | oculto | **3 desabilitados, "Contato não configurado"**, `aria-disabled` |
| `?wa=5561988887777` | ativo | 3 ativos |
| `window.CASA_AURA_WHATSAPP` | **ativo** (antes: oculto) | 3 ativos |

Número de produção configurado: **5561993666859**.

### Telemetria

Desligada por padrão e **nada é enviado a terceiro** enquanto `url` e
`chave` não forem preenchidas. Nenhum dado pessoal no payload; a sessão é
um UUID gerado na hora.

---

## 8. Matriz de aceite

| critério | estado |
|---|---|
| `npm run typecheck` sem erro | `DONE` |
| `npm run build` sem erro | `DONE` |
| `npm run build:unico` sem erro | `DONE` |
| Hash do artefato registrado | `DONE` |
| Boot: cena pronta ou fallback, sem loading infinito | `DONE` — 9 de 9 cenários |
| FSM: nenhuma transição inválida prende a interface | `DONE` — `npm run teste:fsm`: 42 pares exercitados + 7 propriedades, 0 falhas |
| Câmera: todos os planos testados | `DONE` (rodada anterior) — erro de mira 0,00–0,01° nos 8 planos |
| CTA configurado e testado | `DONE` |
| Responsividade desktop e celular | `PARTIAL` — viewport 360×640 verificado; aparelho real não |
| Acessibilidade: foco, teclado, Escape, labels | `PARTIAL` — feito no modo seguro; auditoria da cena 3D não executada |
| Performance p50/p95/p99 em aparelho real | `UNMEASURED` |
| Visual: capturas observadas e registradas | `DONE` — 7 válidas pelas câmeras do produto, `erro = 0` em todas |
| Comercial: planos e escopos aprovados | `BLOCKED` — depende da sua aprovação |
| Fallback honesto, sem assets inexistentes | `DONE` |
| Publicação | `BLOCKED` — `api.netlify.com` bloqueado pela rede deste ambiente |

---

## 9. O que não tem número, e por quê

Esta máquina **não tem GPU**. Renderiza por software a cerca de
0,1 quadro por segundo. Qualquer FPS que este documento afirmasse seria
invenção.

| item | estado |
|---|---|
| Tempo de quadro em hardware real | `UNMEASURED — REQUIRES TARGET HARDWARE` |
| Boot em até 8 s | `UNMEASURED` — os 416 s daqui não representam hardware real |
| Modo seguro em até 6 s em GPU lenta | `UNMEASURED` — o caminho existe e a lógica está escrita; o tempo não |
| Nenhum quadro acima de 500 ms em transição | `UNMEASURED` |
| Teste em celular, tablet e notebook | `NOT_STARTED` — ver `MATRIZ_DISPOSITIVOS.md` |

O instrumento está pronto: abrir com `?debug=1`, explorar 60 s, ler a
linha `[perf]` e o painel de tier. É por isso que a matriz de
dispositivos está **vazia** em vez de preenchida com estimativa.

---

## 10. Riscos que permanecem

1. **Nenhuma medida em hardware real.** É o maior risco aberto. Todo o
   sistema de tiers foi escrito e tipa-verificado, mas o caminho
   `PRESENTATION_SAFE` nunca foi exercitado num aparelho que realmente
   desabe.
2. **Quatro defeitos visuais abertos**: deck e piso de terraço lendo como
   vazio no golden hour, piscina verde-musgo pela mesma causa, tiling da
   textura de grama, copas próximas lendo como massa de cartões. Os dois
   primeiros são de **iluminação em sombra sob sol rasante**, não de
   material — a comparação com o quadro noturno provou isso.
3. **Os testes novos rodaram parcialmente aqui.** `teste:fsm` roda em
   ~1 s e passou. `teste:aba-escondida` precisa de navegador e, sem GPU,
   de cerca de dez minutos por boot: está `UNTESTED`.
4. **Preços e escopos comerciais não aprovados** por você.
5. **`vite`/`esbuild` com CVE** — só dev server, mas convém não expor.
6. **Sem assets reais.** A casa é 100% procedural. É uma força (274 KB de
   fonte) e um limite (o realismo tem teto).
