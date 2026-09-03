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

### Defeito aberto

**Retorno do background não recupera.** Quem abre o link numa aba de
fundo cai no fallback e **continua nele** ao voltar. Medido:
`aposRetorno` permanece `FALLBACK`. `PARTIAL` — o desfecho é
determinístico e honesto, mas deveria haver recuperação.

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

Seis capturas geradas da cena e **efetivamente inspecionadas**. Nenhuma
afirmação visual aqui vem de inferência geométrica.

| captura | veredito |
|---|---|
| exterior dia | `VISUAL VERIFIED` — arquitetura lê, pedra com fiada, **sem z-fighting no gramado**, mata assentada no relevo |
| golden hour terraço | `VISUAL VERIFIED` — luz quente correta; **~35% do quadro em preto absoluto** |
| exterior noite | `VISUAL VERIFIED` — melhor quadro da série; **colina de fundo verde e clara** |
| piscina golden | `VISUAL VERIFIED` — interior lê muito bem pelo vidro; **água verde-musgo e opaca** |
| interior dia | **inválida** — instrumento, não produto |
| interior noite | **inválida** — mesma causa |

### Confirmações positivas

As duas correções estruturais da rodada anterior **aparecem na imagem**:
não há linha de interseção nem cintilação no gramado, e a mata distante
está assentada no relevo em vez de flutuar. Isso fecha, com imagem, o que
antes era só prova numérica.

### As duas capturas inválidas

Setei a câmera à mão para dentro do envelope e `clampFreeCamera` a
**expulsou** — o guarda anti-clip funcionando como projetado. O interior
só é alcançável pelo caminho do produto. É defeito da minha captura, e o
mesmo erro de instrumento já registrado em rodada anterior.

### Defeitos visuais

| # | defeito | estado |
|---|---|---|
| A | Colina de fundo verde e clara à noite | **corrigido**, recaptura pendente |
| B | Água da piscina verde-musgo e opaca | ablação executada, correção pendente |
| C | 25–35% do quadro em preto absoluto na golden hour | `ABERTO` |
| D | Tiling visível da textura de grama | `ABERTO` |
| E | Copas próximas leem como massa de cartões | `ABERTO` |

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
| FSM: nenhuma transição inválida prende a interface | `PARTIAL` — varredura exaustiva não executada nesta rodada |
| Câmera: todos os planos testados | `DONE` (rodada anterior) — erro de mira 0,00–0,01° nos 8 planos |
| CTA configurado e testado | `DONE` |
| Responsividade desktop e celular | `PARTIAL` — viewport 360×640 verificado; aparelho real não |
| Acessibilidade: foco, teclado, Escape, labels | `PARTIAL` — feito no modo seguro; auditoria da cena 3D não executada |
| Performance p50/p95/p99 em aparelho real | `UNMEASURED` |
| Visual: capturas observadas e registradas | `DONE` — 4 válidas, 2 inválidas por erro de instrumento |
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
2. **Retorno do background não recupera** da tela de fallback.
3. **Três defeitos visuais abertos** (preto absoluto na golden hour,
   tiling de grama, copas próximas).
4. **Preços e escopos comerciais não aprovados** por você.
5. **`vite`/`esbuild` com CVE** — só dev server, mas convém não expor.
6. **Sem assets reais.** A casa é 100% procedural. É uma força (274 KB de
   fonte) e um limite (o realismo tem teto).
