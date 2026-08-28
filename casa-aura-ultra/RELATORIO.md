# Casa Aura Ultra — relatório de execução

Branch: `claude/casa-aura-ultra`. Este documento separa o que **roda**, o
que foi **medido**, o que está **parcial** e o que está **pendente** — com
o bloqueio real e a próxima ação de cada pendência.

Regra usada em todo o documento: *infraestrutura não é implementação*. Um
módulo que existe, compila e nunca produz efeito visível está listado como
pendente ou parcial, não como pronto.

---

## Limite do ambiente, declarado de saída

Esta máquina **não tem GPU**. O navegador roda com SwiftShader, a ~0,1
quadro por segundo. Consequências, sem rodeios:

- **Nenhum número de FPS neste relatório é real, e não há nenhum.**
  Qualquer "60fps validado" seria invenção.
- O boot da cena leva ~230 s aqui. Em GPU real esse trecho é dominado por
  compilação de shader e geração do PMREM, na casa de 1–3 s.
- O que **pode** ser medido aqui, e foi: presença e contagem de objetos,
  erros de shader, estado da máquina de estados, diferenças A/B de pixel
  entre duas configurações do mesmo quadro, e sinal de áudio.

Para medir desempenho de verdade: abrir no aparelho alvo e ler
`window.__auraCena.Perf` e `window.__auraMarcos`.

---

## Verificação final em navegador

Feita depois da revisão de código e dos 15 consertos. Tudo abaixo é
medido, não inferido.

| verificação | resultado |
|---|---|
| erros de console e de página | **0** |
| estado alcançado | `HERO` → marco `pronto` |
| malhas na cena | **154** (eram 174) |
| anti-aliasing | `msaa` |
| feixes volumétricos | 4 construídos, 3 acesos ao amanhecer, 4 na hora dourada (0,42), 0 à noite |
| marcadores | 10, todos em DOM |
| CTAs de plano | 3, ligados aos planos reais (Avulso / Mensal / Premium) |
| grid de planos inventado | removido |

**A queda de 174 para 154 malhas são exatamente as 20 malhas de hotspot
duplicadas** que a revisão apontou — a contagem bate com a previsão.

---

### O defeito que congelava a cena
Era o mais grave do projeto e ficava escondido atrás do botão de som.
Medido contando quadros com `requestAnimationFrame`:

| | quadros em 20 s |
|---|---|
| antes de ligar o som | 4 |
| depois de ligar o som | **4** |

Quatro quadros em vinte segundos é o renderizador em software; o que
importa é que **continua contando**. Com o defeito, a contagem ia a zero
e não voltava nunca — `getWorldDirection()` lançava dentro do gancho por
quadro e o `WebGLAnimation` do three parava de pedir quadros.

### Modo Apresentação
Aos 24 s da entrada: `travada: true`, orbit desligado, legenda "Chegada",
progresso 12,5%, `Experience.state === 'presenting'`. Os três consertos
(trava do orbit, estado do legado, índice) funcionando juntos.

Na primeira amostragem, aos 12 s, `travada` ainda era `false` e a legenda
estava vazia — **não era defeito**: o fade de 400 ms da FSM depende de
`setTimeout`, e a 0,2 quadro por segundo os temporizadores só disparam
nas frestas entre quadros. Confirmado esperando mais.

---

## Linha de base medida (tier `ultra`, build de produção)

Colhida com `renderer.info.autoReset = false` e um `reset()` imediatamente
antes do quadro medido. Sem isso, `info.render.calls` devolve as chamadas
do **último passe do composer** — um quad de tela cheia, ou seja `1`. A
primeira versão desta varredura reportou exatamente esse `1`, que não é
uma medição de nada.

| grandeza | valor |
|---|---|
| malhas simples (inclui `Points`) | 138 |
| malhas instanciadas | 20 |
| triângulos no grafo | 124 409 |
| **triângulos desenhados por quadro** | **967 372** |
| **chamadas de desenho por quadro** | **1 082** |
| materiais / geometrias / texturas | 101 / 137 / 60 |
| luzes / com sombra | 17 / 1 |
| malhas que projetam sombra | 38 |
| programas compilados | 63 |
| passes do composer | 7 (o de DOF entra desligado fora do modo cinema) |
| pixelRatio | 1 |

O número que importa é a razão **967 mil desenhados / 124 mil no grafo ≈
7,8×**. Ela vem de três lugares somados: o passe de sombra (38 emissores),
o passe de transmissão do vidro (o Three.js redesenha a cena opaca inteira
para o alvo de transmissão) e os passes de tela cheia. É o argumento
concreto para o vidro com `transmission` continuar restrito a `ultra`/
`high`, como já está.

> **A contagem de malhas não é comparável com o "154" da tabela acima.**
> São regras de contagem diferentes: aquela somava `isMesh` (e
> `InstancedMesh` também tem `isMesh === true`); esta separa instanciadas
> das demais. Não trate a diferença como regressão — nenhuma das duas foi
> recontada com a regra da outra.

---

## Varredura visual — o que a imagem denunciou

Método: build de produção servido por `vite preview` (não o dev server —
editar um arquivo recarregava a página no meio da captura e invalidava a
comparação), quatro câmeras fixas, e uma sonda de pixels que devolve
mínimo, máximo, mediana, média e desvio de luminância de um retângulo.

Duas armadilhas do próprio instrumento, encontradas antes dos defeitos:

- **`controls.enabled = false` não segura a câmera.** Em `OrbitControls`
  os `return` por `enabled` estão só nos handlers de evento; `update()`
  recalcula a posição a partir do esférico e termina em
  `object.lookAt(target)`. A captura "sala-interior" saiu como vista
  aérea externa: mexi no alvo, e o próximo `update()` devolveu a câmera
  para o mesmo raio em volta dele. A guarda certa é
  `window.__auraCameraTravada`, que o laço do legado já respeita.
- **`info.render.calls` lido depois do composer devolve `1`** (o quad do
  último passe). Ver a seção da linha de base.

### 1. A cobertura lia como água — CORRIGIDO E MEDIDO

O maior defeito do quadro exterior: a laje de cobertura, ~25% da imagem,
aparecia azul-marinho e ondulada.

| região da manta | antes | depois |
|---|---|---|
| R / G / B médios | 76,6 / 87,3 / **103,2** | **51,5** / 46,7 / 46,1 |
| razão B ÷ R | **1,35** | **0,90** |
| mediana de luminância | 81,3 | 33,3 |

O albedo do material (`#34343a`) tem B ÷ R = 1,12. Antes a superfície era
*muito mais azul que o próprio albedo* — ou seja, o que se via era o céu
refletido, não a manta. Depois ela lê um pouco mais quente que o albedo,
que é o que a luz do sol faz. Causa única: `roughness 0,52` +
`metalness 0,12` + `envMapIntensity` cheia transformavam a laje em
espelho.

Registro de um erro meu no caminho: escrevi no código que havia **três**
causas, incluindo escala errada de `map` e de `normalMap`. As duas eram
invenção — `sharedBox` passa por `applyWorldUV`, e a UV já vem em metros
(`TILE_M = 1,6`), então a emenda de rolo já caía na largura real do rolo.
Cheguei a trocar as duas por valores piores antes de ler `applyWorldUV`.
O comentário no código foi corrigido para dizer isso.

Aproveitando: `M.grafite` servia a manta E ao rufo/capeamento do
parapeito, que na obra são materiais diferentes. Agora são dois, e os
mapas dos dois entraram na lista de anisotropia — nenhum dos dois estava
lá, numa superfície que só é vista em ângulo rasante.

### 2. Perspectiva aérea com degrau — CORRIGIDO

Medido acima e abaixo da linha do horizonte:

| faixa | distância | desvio de luminância |
|---|---|---|
| colina distante | 225–435 m | **5,2** |
| faixa de mata | 46–158 m | **33,0** |

Seis vezes mais contraste local **na frente** de um fundo já quase
apagado. A névoa não estava errada; a massa arbórea é que **terminava** em
158 m. Com `FogExp2(0,0033)`: 158 m → 24% de névoa, 225 m → 62%. Entre um
e outro, 67 m de nada, justo onde a curva é mais íngreme.

Corrigido preenchendo a faixa (dois anéis a mais, até ~218 m, com porte
crescente), não mexendo na névoa. Fora de `low` e `medium` — a conta de
custo de preenchimento está no comentário do código.

Conferido reimplementando a distribuição dos anéis e cruzando com a curva
de névoa:

| faixa | névoa | árvores antes | depois |
|---|---|---|---|
| 125–150 m | 19% | 182 | 180 |
| 150–175 m | 25% | 93 | 232 |
| **175–200 m** | 32% | **0** | **236** |
| **200–225 m** | 39% | **0** | **303** |
| 225–250 m | 46% | (relevo) | (relevo) |

**Maior salto de névoa entre duas faixas povoadas: 20,9 pontos
percentuais antes, 7,1 depois.** É a medida direta do degrau de
perspectiva aérea, e ele caiu para um terço.

### 3. Galhos como varas de madeira — CORRIGIDO

Ampliando o canto inferior direito: os galhos da árvore de primeiro plano
atravessavam a fachada como canos serrados, sem uma folha em volta.

Não era material nem geometria (o tronco já é cônico). Era o envelope:

    copa:  casca de cartões entre 0,78 e 1,00 de canopyR
    galho: alcance horizontal até 1,22 de canopyR  -> FORA da copa
    galho: base em 0,62 de trunkH, copa começa em trunkH - 0,26*canopyR
                                                   -> nasce ABAIXO dela

O galho nascia abaixo da folhagem e terminava fora dela, com a ponta
contra o céu. Encurtado e com a origem mais alta, a ponta termina dentro
da casca de folhas.

Conferido reimplementando o mesmo sorteio em JS, 200 mil árvores, e
testando a ponta contra o elipsoide da copa:

| | antes | depois |
|---|---|---|
| ponta do galho **fora** da copa | 38,3% | **0,4%** |
| pior caso (1,0 = na casca da copa) | 4,34 | **1,39** |
| galho nasce abaixo da copa | 94,8% | 51,6% |

A última linha continua alta **de propósito**: galho de árvore sai do
tronco abaixo da massa de folhas mesmo. O defeito era a PONTA no céu, e
essa saiu de 38% para praticamente zero.

### 4. O núcleo em pedra lia como bloco de concreto — ALTERADO, CONFIRMAÇÃO VISUAL PENDENTE

O elemento herói do projeto aparecia como muro de blocos: retângulos
creme lisos com junta de fio claro.

**Não era falta de variação de tom** — a sonda mediu desvio 18,3 na
região, e o gerador já sorteia tom peça a peça. Eram outras duas coisas:

- A junta tinha 9 mm num mapa de 512 px cobrindo 1,6 m. Nessa distância a
  parede ocupa ~114 px/m, então a junta caía em **um pixel de tela**: o
  mipmap a dissolvia e sobrava o lábio claro do normal map, não o vinco.
  Junta de pedra precisa ser escura mesmo com 1 px — e quem faz isso é o
  albedo, não o relevo.
- `baseFreq: 6` sobre 1,6 m dá feições de 27 cm: grosso demais para grão,
  fino demais para veio. Cada peça saía um degradê limpo, sem superfície.

A junta passou de 9 mm para 1,9 cm (de ~1,1 para ~2,1 px de tela nesta
distância) e `albedoCavity` de 0,50 para 0,60, para ela ser escura no
albedo e não depender do relevo. `baseFreq` foi de 6 para 12 e ganhou uma
quinta oitava. **Diferente dos outros três itens, este ainda não tem
confirmação por imagem** — a varredura que a produz não terminou até o
fechamento deste texto.

### Encontrado, reproduzido e NÃO corrigido

- **Trama regular no gramado.** Volta a aparecer em ângulo rasante, apesar
  do conserto anterior (`noiseNormalTexture(8)` → `(24, 1.15)`). A
  hipótese é moiré por subamostragem: `map.repeat` 450 e `normalMap.repeat`
  317 sobre o disco de 260 m, com anisotropia limitada a 8 de um máximo de
  16. **UNMEASURED — REQUIRES TARGET HARDWARE**: a filtragem de textura do
  SwiftShader não representa a de uma GPU real, então subir a anisotropia
  aqui não provaria nada. Precisa de uma passada em GPU antes de mexer.
- **Manchas brancas no vidro.** Elipses suaves sobre o guarda-corpo e o
  pano de vidro, com cara de mancha e não de brilho. Origem não
  determinada (candidatos: especular de `PointLight` espalhada pelo bloom,
  ou as `RectAreaLight` das janelas). Não mexido sem saber a causa.
- **A cena não é determinística.** A vegetação usa `Math.random()` sem
  semente, então cada carregamento gera uma floresta diferente. Isso torna
  A/B de qualquer coisa perto de vegetação pouco confiável — as medições
  acima foram escolhidas para não depender disso (razão de canal na mesma
  superfície, desvio dentro de uma faixa). Semear o gerador é a próxima
  ação óbvia, e não foi feita nesta rodada para não trocar a aparência de
  toda a vegetação junto com quatro outras mudanças.

### Verificado como CORRETO — não mexer

Duas coisas que o enunciado alertava e que **já estavam certas**:

- O relevo distante é baixo, hazeado e proporcional (225–435 m, 16–50 m de
  altura). Não é o erro histórico de "montanhas gigantes e próximas".
- A vegetação usa cartões instanciados com recorte alfa, não esferas.

E uma terceira, que quase "corrigi" por engano: o guarda-corpo de vidro do
terraço **não** está opaco. O cinza que se vê através dele é a parede
clara que está atrás. `transmission` funciona (dá para ver o mobiliário
através do pano térreo) e o fallback opaco de `adaptMaterialsToQuality()`
não se aplica em `ultra` (`if (q.glass === 'full') return`).

---

## IMPLEMENTADO E MEDIDO

### Anti-aliasing — era um defeito real, não uma melhoria
O renderizador é criado com `antialias: true`, mas com `EffectComposer` a
cena **nunca é desenhada no framebuffer padrão**, e os render targets que o
Three.js cria não têm `samples`. Ou seja: nos tiers ultra, high e medium —
exatamente os que têm pós-processamento — a casa rodava com **zero**
anti-aliasing, atrás de uma flag que parecia ligada.

Corrigido: MSAA 4× nos alvos do composer em ultra/high, SMAA em medium.
Verificado em navegador: `AA: msaa`.

### Cáusticas da piscina
Malha de luz no revestimento do casco (não na superfície — é no fundo que
a luz refratada bate).

**Este efeito não funcionava quando foi escrito, e só um A/B mostrou
isso.** O domínio de entrada da função estava errado: com as coordenadas
da piscina em metros, o termo interno saturava e a função devolvia `1,0`
em todo ponto — uma constante, não uma cáustica. Conferido reimplementando
a função em JS: média 1,0000, cobertura 100%, em toda escala testada.

Corrigido com o desdobramento `mod(uv*TAU, TAU) - 250`. Mesma varredura
depois: média 0,11, pico 0,68, 27% da área acima de 0,15.

| medida (câmera do capítulo Piscina) | antes | depois |
|---|---|---|
| pixels do quadro alterados com sol 1 vs 0 | 0,68% | 1,57% |
| piso de ruído temporal (sol 1 vs sol 1) | 0,39% | — |
| fração do quadro ocupada pelo casco | 1,50% | 1,50% |

O número que importa é o último: a cáustica passou a cobrir **todo o
revestimento visível**, e antes cobria o equivalente a ruído.

### Feixes volumétricos (god rays)
Geometria aditiva, um prisma por abertura, com teste de face para não
acender fachada que o sol não alcança. Sem passe de tela e sem alvo extra.

Varredura da hora solar, com o auto-scaler travado por `?q=`:

| hora | grupo | feixes acesos | intensidade |
|---|---|---|---|
| 0,00 | off | 3 | 0 |
| 0,30 | off | 4 | 0 |
| 0,50 | **on** | 4 | 0,110 |
| 0,62 | **on** | 4 | 0,318 |
| 0,72 | **on** | 4 | 0,420 |
| 0,80 | **on** | 1 | 0,352 |
| 0,86 | **on** | 1 | 0,244 |
| 0,92 | off | 1 | 0 |
| 1,00 | off | 1 | 0 |

A queda de 4 para 1 feixe a partir de 0,80 é o teste de face funcionando:
o sol gira para oeste, o pano de vidro sul deixa de recebê-lo e só a
abertura oeste continua acesa.

Um defeito encontrado e corrigido nessa medição: a cauda da gaussiana
deixava intensidade 0,048 com t = 1,0, ou seja **facho de sol depois do
pôr do sol**. Agora há uma janela dura de 0,48 a 0,86.

### Partículas na GPU
Poeira, fumaça e pássaros, com todo o movimento no vertex shader. Nenhuma
posição atualizada em JavaScript.

A fumaça também nasceu errada e foi corrigida medindo: 120 partículas a
0,24 de opacidade com ~97 px de tamanho empilhavam um **disco branco**
sobre a área gourmet. Além disso a origem estava em (-12,2 / 2,4), um
palpite meu — a churrasqueira está em (2,7 / 10,4), então a fumaça saía de
dentro da casa. A/B depois do ajuste: 0,78% do quadro afetado, diferença
média 3,49 por pixel. Presente sem dominar.

### Áudio espacial
Os MP3 do manifesto (`ambient_garden`, `water_loop`) **nunca existiram no
repositório**. Em vez de um player apontando para arquivos ausentes, o
ambiente é sintetizado: vento e lâmina d'água são ruído filtrado com
envoltória lenta, empacotados em WAV mono de 16 bits e entregues ao Howler
por blob URL. Mono porque o `PannerNode` só posiciona fonte mono.

| medida | jardim | água |
|---|---|---|
| RMS | 0,0374 | 0,0415 |
| pico | 0,229 | 0,256 |
| descontinuidade do laço | 0,0115 | 0,0208 |
| degrau típico entre amostras | 0,0127 | 0,0157 |

A emenda do laço é **menor que um passo comum de amostra** no jardim e da
mesma ordem na água: o laço não estala. Geração em 62 ms.

### Fallback sem WebGL
Verificado forçando `getContext('webgl')` a devolver `null`. Monta planta
em canvas 2D com ambientes nomeados, escala de 5 m, ficha técnica de 6
itens e link do WhatsApp montado a partir de `?wa=`. Planta 714×418 com
25,2% de tinta — não é um retângulo vazio.

Não importa `three.js` e não lê nada da cena: um fallback não pode
depender do que falhou.

### Modo Apresentação
Oito planos com movimento contínuo, legenda sincronizada, barra de
progresso e queda no painel comercial ao final. É aqui que o
`CameraDirector` é exercitado — slerp de orientação, dolly zoom e rack
focus não existem no voo herdado.

Verificado: `HERO -> PRESENTATION`, legenda "Chegada" correta, progresso
em 12,5% (1 de 8), câmera percorrendo a curva, controles entregues ao
diretor.

Um botão morto encontrado aqui: `HERO -> PRESENTATION` não estava na
tabela da FSM, e o botão "Apresentação" fica na barra de modos desde o
hero — clicar nele não fazia absolutamente nada.

### Modo Seção — plano de clipping com tampa por stencil
Seção de arquitetura em três eixos (transversal, longitudinal, planta),
com plano deslizante, painel próprio e atalhos (`C` liga/desliga, setas
movem, `Shift` refina). A tampa fecha a face cortada; o volume removido
aparece em arame, para o corte não ser ambíguo.

| medida | valor |
|---|---|
| malhas estruturais com tampa | 23 |
| malhas de stencil (2 por sólido) | 46 |
| materiais recortados | 75 |
| chapas excluídas da tampa (não são sólidos fechados) | 1 |
| cobertura da tampa, `NotEqual` (correto) | 4,9% do quadro |
| cobertura da tampa, `Equal` (invertido, controle) | 80,0% |

As duas últimas linhas são o teste que provou que o stencil discrimina:
invertendo a função, a tampa passa a cobrir exatamente o complemento.

### Teto de luzes por tier
Cada luz real entra no laço do fragment shader — custo por pixel vezes
número de luzes — e mudar a contagem recompila os shaders, o que produz um
engasgo justo quando as luminárias acendem ao anoitecer. O teto corta as
luminárias mais distantes da câmera nos tiers móveis, reavaliando a cada
2,5 s com histerese de 2 m. As cúpulas continuam acesas: a cena já mantém
`emissiveFixtures`, que brilham sem custo de iluminação.

**A premissa inicial estava errada e o módulo nasceu inerte.** Escrevi
supondo uma dúzia de pontos de luz e pus o teto de `medium` em 6.
Contando: a cena tem **5** luminárias e **9** luzes no total — com teto 6
o arquivo não cortava nada, ou seja eu tinha acabado de criar um botão
morto, do mesmo tipo que este documento passa o tempo todo denunciando.

Tetos corrigidos para valores que vinculam. Medido em `medium`:

| medida | antes | depois |
|---|---|---|
| luminárias ativas | 5 | 4 |
| PointLights no laço | 6 | 5 |
| luzes contando para o shader | 9 | 8 |

É um ganho modesto. É o ganho que existe.

### GLSL em `src/shaders/`
Nove shaders saíram dos módulos de efeito para arquivos `.vert`/`.frag`/
`.glsl`, carregados com o `?raw` nativo do Vite.

**Verificado sem render** (a rodada de navegador foi recusada nesta
etapa), por dois caminhos que juntos cobrem o risco real:

1. Comparação token a token de cada shader extraído contra o texto
   embutido no commit anterior, ignorando espaços e comentários — os
   **nove batem exatamente**. GLSL idêntico ao que já compilava compila
   igual.
2. Build limpo, e `casaAura_caustica`, `casaAura_dominio`,
   `casaAura_lado`, `casaAura_paraCamera` e `gl_PointCoord` aparecem no
   bundle. Isso descarta o modo de falha que importaria: um `?raw`
   resolvendo para string vazia passa no typecheck e quebra em silêncio.

O que isso **não** prova: que a cena renderiza. Para isso falta a rodada
de navegador.

### Dados em `src/data/`
`chapters.json` (13 capítulos) e `presets.json` (4 paradas atmosféricas)
saíram do literal embutido no legado. O corretor consegue reordenar ou
renomear capítulo sem abrir código.

O desenho que importa: o legado **lê** desses arquivos. Não copiei os
valores para o JSON deixando duas cópias da mesma informação — fonte
única, sem risco de divergirem.

Verificado reconstruindo a partir do JSON e comparando com o literal do
commit anterior: **4 paradas × 16 chaves = 64 valores de luz** e os **13
capítulos campo a campo**, todos idênticos. Essa checagem não é
cerimônia: estes números são a coisa mais calibrada do projeto, e um
dígito trocado em `sunI`, `envI` ou `indoorFill` mudaria a leitura da
casa inteira sem nenhum erro aparecer.

### Build
`vite build` limpo. Caminho crítico: **11,8 kB de entrada + 16,7 kB de
CSS**. `three.js` (346 kB gzip), a cena, GSAP e Howler ficam todos fora
dele e entram sob demanda. Build verificado rodando em navegador com o
mesmo roteiro do dev: 0 erros.

---

## PARCIAL

**Profundidade de campo.** Implementada com rack focus e ligada só em
ultra e só nos estados de câmera composta (`CINEMATIC`, `PRESENTATION`) —
DOF durante exploração livre briga com o olhar do usuário e custa um
render de profundidade da cena inteira. **Não foi possível vê-la aqui**:
este ambiente é classificado como tier `high`, então o passe nunca ligou.
Próxima ação: abrir com `?q=ultra` num aparelho com GPU e entrar no modo
Apresentação.

**Cáusticas em medium e low.** Desligadas: são três iterações por pixel do
casco. Nesses tiers a piscina continua com o visual anterior.

**`src/legado/cena-bruta.ts`.** Ainda são 7.100 linhas com `@ts-nocheck`.
A cena foi transplantada inteira de propósito — ela é a versão que se sabe
que funciona, calibrada renderizando. Os módulos novos foram esculpidos ao
redor dela, não por dentro. Reescrevê-la é trabalho de várias sessões e
sem ganho visível para o cliente.

---

## PENDENTE

**Galeria 360° no fallback.** O projeto pede galeria; galeria precisa de
panoramas, e não existe nenhum no repositório. Desenhar retângulos e
chamar de foto seria pior que não ter. Entreguei planta + ficha + contato,
que é conteúdo real e útil no mesmo lugar. Bloqueio: ausência de imagens.
Próxima ação: capturar 6 panoramas equiretangulares da própria cena num
aparelho com GPU (`CubeCamera` + conversão) e guardá-los em `public/360/`.

**Supabase.** A migração `supabase/migrations/0001_casa_aura.sql` está
escrita e **não foi aplicada**. A organização existe e tem zero projetos;
criar um é ação cobrada e externa, então não fiz por conta própria.
Próxima ação: você cria o projeto e eu aplico a migração e ligo o cliente.

**Não iniciados**, do escopo original: KTX2/Basis, PMREM pré-assado,
`BatchedMesh`, BVH, SSR, TAA, LOD/impostores de vegetação, lightmaps
assados, culling por portais, e `AssetManager`/`InputManager` como
módulos próprios.

*(A rodada de navegador que faltava foi feita — ver "Verificação final"
no topo. Zero erros.)*

---

## O que a medição desmentiu

Vale registrar, porque foi caro descobrir:

1. **A cáustica que não fazia nada.** Compilava, o uniform era
   compartilhado, a injeção estava no shader — e o resultado era uma
   constante. Nada disso apareceria sem o A/B contra um piso de ruído.
2. **O anti-aliasing que a flag prometia.** `antialias: true` estava lá o
   tempo todo, e era inerte.
3. **Os hotspots que eu dei como quebrados.** Reportei zero marcadores; era
   defeito da minha medição — eu amostrava no marco `pronto` enquanto o
   `iniciar()` não aguardado ainda resolvia. Nunca estiveram quebrados.
4. **A churrasqueira que eu chutei.** Inventei uma coordenada em vez de ler
   a da cena, e a fumaça saía de dentro da sala.
5. **O buffer de stencil que o composer não carregava.** Mesmo padrão do
   anti-aliasing: o renderizador tem a capacidade, o `EffectComposer` cria
   os render targets sem ela, e o teste de stencil passava em todo pixel.
6. **A caixa de 900 metros.** `Box3.setFromObject(houseGroup)` inclui o
   terreno. O plano de corte caía a 45 m da casa e a tampa virava um
   quadrado de 1440 m.
7. **A tampa que eu culpei sem medir.** Metade do mundo sumia no Modo
   Seção e eu passei três rodadas atrás da tampa de stencil. A tampa
   estava certa (4,9% do quadro); o que sumia era o gramado, porque eu
   havia aplicado o plano de clipping ao terreno junto com a casa.
8. **A dúzia de luzes que não existia.** Escrevi o teto de luzes supondo
   uma cena cheia de pontos ao anoitecer. São 5 luminárias. O teto que
   escolhi não cortava nada — o módulo nasceu inerte e só um `console.info`
   com a contagem real revelou isso.
