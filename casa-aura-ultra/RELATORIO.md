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

### 4. O núcleo em pedra lia como bloco de concreto — RESOLVIDO POR ABLAÇÃO

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

**Tentei corrigir duas vezes e errei as duas.** Fica registrado inteiro,
porque a próxima pessoa vai ter exatamente as mesmas ideias:

| tentativa | hipótese | resultado medido na imagem |
|---|---|---|
| 1 | junta fraca demais → alargar para 1,9 cm e escurecer no albedo | leitura de bloco ficou **mais** categórica |
| 2 | peça pequena demais → 2 fiadas, painel grande, junta fina, mais variação de tom | **tabuleiro de xadrez** de dois tons |

O erro da primeira foi reforçar o sinal errado: junta visível somada a
peça média em amarração corrida é a *definição* visual de alvenaria. O
erro da segunda foi de amostragem: com 2 fiadas e 1–2 peças por ladrilho,
o tom por peça vira poucas células grandes, e o ladrilho se repete ~4,4
vezes na parede — variação maior não virou riqueza, virou padrão.

Revertidas as duas, e então **construí a ferramenta que eu mesmo tinha
apontado como o caminho certo**: `src/legado/pedra-lab.ts` mais
`dev/pedra-lab.html`. Ela gera o albedo pelas **mesmas funções da cena**
(`heightField`, `carveCourses`, `pbrFromHeight`, importadas e não
copiadas — bancada que reimplementa mede outra coisa) e desenha num
canvas 2D. Sem WebGL, sem cena, sem iluminação: **4 segundos por rodada
em vez de 10 minutos, e oito variantes no mesmo quadro.** Um ganho de
~150× no laço de iteração, e foi isso que destravou o problema.

A bancada também corrigiu um erro de **escala de julgamento** que eu vinha
cometendo: na captura da fachada a parede ocupa ~230 px para 7,0 m, ou
seja ~52 px por ladrilho de 512 px — quase 10× de minificação. Eu estava
decidindo olhando o mapa em 1:1, um tamanho em que o olho nunca o vê. Cada
painel da bancada mostra a parede na escala real da captura E o detalhe.

**A ablação, que é o que resolveu.** Em vez de mexer em tudo de uma vez,
separei os dois sinais (`depth: 0` remove a junta e mantém o tom;
`tomFaixa: 0` mantém a junta e chapa o tom):

| variante | resultado |
|---|---|
| só o TOM (sem junta) | **não lê como bloco** |
| só a JUNTA (tom chapado) | **lê como bloco, igual ao controle** |
| tom cortado pela metade | continua bloco |
| nem junta nem tom | liso, sem caráter |

A junta sozinha produz 100% da leitura de alvenaria. **Nas duas tentativas
anteriores eu tinha reforçado exatamente o sinal que precisava
enfraquecer.**

Mas apagar a junta deixa a parede lisa como reboco pintado — pior para um
elemento herói. A saída é a **frequência**, não a força: com 3 fiadas por
ladrilho a peça tem 53 cm e o olho lê *unidade de alvenaria*; com 10 ela
cai para 16 cm e o olho lê *estratificação*, que é pedra assentada. Com 14
a modulação dissolve num chuvisco.

Efeito de segunda ordem que só apareceu depois, e que corrige a conclusão
da ablação: **com peça pequena o degrau de tom volta a ser visível.** Ele
era invisível com peça de 53 cm, não em geral. Por isso a faixa de tom foi
recalibrada de 46 para 32 — em 40 a parede começa a listrar, em 24 perde
vida.

Valores finais: 10 fiadas, junta de 5 mm rasa (`depth 0,26`) e discreta
(`albedoCavity 0,35`), tom de 104 a 136, mais o grão de `baseFreq 12` que
já tinha se mostrado bom.

Medido na cena real, na mesma região da parede:

| região da pedra | antes (bloco) | depois (estratificada) |
|---|---|---|
| mediana de luminância | 176,6 | **152,0** |
| desvio | 18,3 | **19,0** |
| R / G / B | 189 / 179 / 159 | 163 / 153 / 132 |

O desvio é praticamente **o mesmo**: a variação não aumentou, ela mudou de
frequência. É a confirmação numérica de que o problema nunca foi *quanta*
variação existia — foi *onde* ela estava — e portanto de que a tentativa 2,
que aumentou a variação, atacava a grandeza errada. A parede também
escureceu 25 níveis, afastando-se do creme estourado que puxava para
concreto pintado.

A bancada fica no repositório: a página é `dev/`, fora do build, e o
bundle cresceu 0,2 kB (108,27 → 108,47 kB) — confirmado com `grep` no
`dist/`, que não contém nada dela.

### 5. A barra de capítulos não levava a lugar nenhum — CORRIGIDO E MEDIDO

O achado mais grave desta rodada, e ele não estava na imagem: estava no
comportamento. Sondando `goToChapter(4)` ("Sala de Estar") com a
experiência em `ready` — o estado de quem está orbitando à vontade, que é
como o cliente usa a barra de capítulos:

| tempo | estado | câmera | distância do alvo |
|---|---|---|---|
| ~4 s | ready | (17 / 8,5 / 15) | 29,0 m |
| ~10 s | ready | **(−8,6 / 1,6 / 3,2)** | **0,0 m** ← chegou |
| ~20 s | ready | (17 / 8,5 / 15) | 29,0 m ← **expulsa** |
| ~40 s | ready | (17 / 8,5 / 15) | 29,0 m |

O corte põe a câmera dentro da sala e, no quadro seguinte,
`clampFreeCamera()` vê "está dentro do envelope agora, estava fora antes"
e devolve a posição anterior. O cliente clica "Sala de Estar", vê um fade,
um piscar do interior, e volta para a vista aérea.

E havia um segundo caminho quebrado no mesmo lugar: capítulos cuja
trajetória **não** cruza o edifício usam voo por curva, e o voo depende de
`lerpCam()`, que o `animate()` só chama em `cinematic`/`presenting`/
`reveal`. Clicado em `ready`, esse capítulo não movia a câmera nenhum
metro.

Ou seja: pela barra de capítulos, em uso livre, **os capítulos internos
piscavam e voltavam e os externos não saíam do lugar**. Os três capítulos
de interior (Sala de Estar, Cozinha & Jantar, Suíte Master) são o miolo do
tour.

Por que sobreviveu a toda a verificação anterior: o Modo Apresentação roda
em `presenting`, estado que a guarda isenta e em que `lerpCam()` roda. A
apresentação guiada sempre funcionou — o que não funcionava era a
navegação manual.

A guarda está **certa** no que ela existe para fazer (impedir que o dedo
arraste a câmera através da fachada). Ela só não distinguia isso de um
salto deliberado. Corrigido nos dois caminhos: no corte, a posição nova
passa a ser o `_camPrev` (é válida por definição); no voo, uma flag
`chapterCamMove` espelhando o que o reveal já fazia, que faz o `lerpCam()`
rodar e isenta a guarda até a chegada.

### 6. A poeira lia como NEVE dentro da sala — CORRIGIDO

Achado imediatamente depois do conserto acima, porque **só então o
capítulo interno virou alcançável**. A primeira captura da "Sala de
Estar" tinha dezenas de discos brancos moles espalhados pelo quadro
inteiro, alguns com ~40 px. Era também a origem das "manchas brancas no
vidro" que eu tinha visto de fora e não sabia explicar.

A conta, que é a prova:

    antes:  gl_PointSize = 1,7 * 30 / d
            -> 51 px a 1 m,  25 px a 2 m,  sem teto
    alpha = smoothstep(60, 6, d)
            -> opacidade MÁXIMA na partícula mais próxima

Grão de poeira real tem ~50 µm. A 1 m, com 38° de campo em 800 px, um
pixel vale ~0,86 mm — o disco estava quatro ordens de grandeza acima do
físico. E grande somado a opaco perto é literalmente a receita de neve.

    depois: gl_PointSize = clamp(0,9 * 30 / d, 1, 6)   // teto de 6 px
    alpha = smoothstep(60, 6, d) * smoothstep(0,35, 1,6, d)
            // some também MUITO PERTO: a 40 cm da lente a partícula
            // estaria fora de foco e sem contraste
    opacidade por partícula: 0,5 -> 0,22 (o blending é aditivo e
            acumulava para branco sólido nos aglomerados)

**Sobre a medição:** tentei três métricas escalares e nenhuma separa o
efeito, então não invento uma. Janela fixa na parede erra o alvo (a
poeira é esparsa e de posição aleatória — duas janelas caíram em trechos
sem partícula nenhuma nos dois quadros, e uma terceira incluía o abajur,
que fixava o máximo em 255 nos dois). Diferença contra uma cópia borrada
detecta a poeira, mas detecta junto toda a aresta de móvel: dá 6,2% antes
e 5,9% depois, ou seja, mede a mobília. A prova aqui é a aritmética acima
mais as duas capturas; o teto de 6 px é exato e não depende de
interpretação.

### 7. Transição de luz contava QUADROS, não tempo — CORRIGIDO

Encontrado na varredura final, que passou a chamar `goToChapter` de
verdade em vez de dirigir a câmera na mão. O capítulo "Piscina" declara
`light: "golden"`, e a sonda registrou `luz: "day", solar: 0` **34 s
depois de entrar nele**.

Não era o capítulo: era `setLightMode`, que avançava `0,016 / dur` por
quadro — 60 fps cravados no código. Quem roda a 30 fps leva o **dobro**
do tempo pedido (3,6 s numa transição de 1,8 s), e aparelho móvel a 30
fps é exatamente o que o resto do projeto passa o tempo protegendo. Aqui,
a 0,1 quadro por segundo, os 1,8 s viravam **dezenove minutos**.

Trocado por relógio real (`performance.now()`), com `dt` limitado a
0,05 s para que uma engasgada não dê um salto na luz. Acima de 20 fps a
transição passa a durar exatamente o que pede; abaixo disso ela estica,
que é preferível a pular.

O que isso vale no aparelho alvo, que é onde importa:

| taxa de quadros | avanço por quadro, antes | depois | duração de uma transição de 1,8 s |
|---|---|---|---|
| 60 fps | 0,0089 | 0,0093 | 1,8 s → 1,8 s (era o único caso certo) |
| 30 fps | 0,0089 | 0,0185 | **3,6 s → 1,8 s** |
| 20 fps | 0,0089 | 0,0278 | 5,4 s → 1,8 s |

Conferido em navegador nesta máquina, onde o efeito é caricato: o
`solarTime` sai de 0 e avança 0,006 → 0,044 → 0,148 → 0,351 em 180 s, de
forma monótona, com **0 erros**. Antes, a varredura registrava 0,003
depois de 34 s — praticamente parado.

Vale registrar que este defeito **só apareceu porque o conserto anterior
tornou a navegação por capítulos utilizável**. Os dois últimos achados
desta rodada saíram um do outro.

### 8. A cena não era a mesma duas vezes — CORRIGIDO E MEDIDO

A vegetação sorteava posição, porte e inclinação com `Math.random()` sem
semente — 127 chamadas no arquivo. Duas consequências, em ordem de
gravidade:

1. **Este é um material de venda.** O corretor abre a casa numa reunião,
   abre de novo na seguinte, e o jardim está diferente. Uma maquete que
   muda sozinha não é uma maquete do imóvel.
2. Nenhum A/B de imagem perto de vegetação era confiável: metade da
   diferença entre dois quadros era o sorteio. Foi por isso que a medição
   do telhado teve de usar razão de canal na mesma superfície.

Trocar as 127 chamadas seria invasivo. Em vez disso `Math.random` é
substituído por um xorshift semeado **durante cada etapa síncrona** de
construção e devolvido num `finally`.

Por etapa, e não uma vez para a cena inteira, por dois motivos:
`buildScene` é `async` e cede um quadro entre etapas — com o patch
atravessando o `await`, qualquer outro código que sorteie nesse intervalo
(three, gsap, o laço de render) entraria no mesmo fluxo e o resultado
deixaria de ser reproduzível; e cada etapa ganha um fluxo próprio
derivado do nome dela, então mexer no paisagismo não desloca o sorteio da
arquitetura. `?semente=N` troca o conjunto inteiro.

Medido com duas cargas independentes, comparando uma impressão digital
que inclui a soma ponderada das 16 componentes de **todas** as matrizes
de instância:

| | carga 1 | carga 2 |
|---|---|---|
| instâncias | 5002 | 5002 |
| triângulos | 104 436 | 104 436 |
| **soma das matrizes** | **171347,886** | **171347,886** |

Não coberto: as partículas (poeira, fumaça, pássaros) nascem em
`CasaAuraScene.ts`, fora das etapas de `buildScene`, e continuam
sorteando. São efeitos em movimento, então não produzem a queixa "o
jardim mudou" — fica registrado por honestidade.

### 9. A trama do gramado não vinha do normal map — CORRIGIDO

Eu tinha classificado este item como **NÃO MEDIDO — exige hardware alvo**,
com o argumento de que a filtragem do SwiftShader não representa a de uma
GPU e que portanto nada aqui provaria nada. **Esse argumento estava errado
no essencial:** ele vale para anisotropia, mas o artefato *reproduz* nesta
máquina, e boa parte das hipóteses é testável sem depender de filtragem.

Primeiro, uma métrica. "Tem trama" é impressão; autocorrelação 2D é
número. Subtrai-se a média local (para não medir o degradê de luz) e
varre-se o plano de defasagem inteiro — em 2D, porque os losangos são
**diagonais** e medir só em x e y os dilui.

Depois, ablação em cena: `repeat` e `normalScale` são propriedades de
textura, então dá para trocá-las **em tempo de execução** e recapturar.
Cinco configurações num boot só, em vez de cinco boots:

| configuração | pico 2D | defasagem |
|---|---|---|
| atual (map 450 / normal 317) | 0,2556 | (−9, 3) |
| **normal map desligado** | **0,2590** | (−9, 3) |
| map 150 | 0,2492 | **(14, 5)** |
| normal 110 | 0,2816 | (−9, 3) |
| ambos aliviados | 0,2284 | **(14, 5)** |

Desligar o normal map **não muda nada** — e era a ele que o comentário do
código atribuía o artefato. Já mexer no `map` **migra a defasagem**: o
período está preso ao ladrilho do mapa difuso. E como aliviar o `repeat`
quase não reduz a intensidade, não é aliasing: é o ladrilho ser
**reconhecível** e se repetir.

**Uma ressalva honesta sobre a métrica.** Na bancada, a variante "sem
manchas" pontua 0,2306 e visualmente não tem repetição nenhuma. Ou seja o
piso da medida é ~0,23, e as magnitudes da tabela acima estão quase todas
dentro dele. O que sustenta as conclusões é a **migração da defasagem**
(um sinal qualitativo robusto) e a inspeção visual da bancada — não os
valores. Não vou tratá-los como precisos.

A causa, vista na bancada repetindo o ladrilho 4×4 na densidade que ele
tem a ~40 m: as **26 manchas de raio 15%–45%** do ladrilho. Num ladrilho
de 58 cm elas medem 9–26 cm — grandes o bastante para o olho reconhecer e
reencontrar a cada 58 cm. Reduzidas a 6%–16% (3,5–9 cm) viram mosqueado
em vez de assinatura.

E a variação de tom que elas davam não se perde: já existe, no lugar
certo. `applyMacroVariation(M.gramado, 11.0, 0.16)` faz isso **no shader,
em 11 m, onde não se repete**. Ter as duas era redundante — e a redundante
era justamente a que tilava.

Verificado em cena, mesma câmera, mesma região, mesmo tamanho de janela
(os dois valores são comparáveis entre si; o que não se deve tratar como
preciso é a magnitude absoluta):

| | pico 2D |
|---|---|
| manchas de 15%–45% | 0,2556 |
| manchas de 6%–16% | **0,2080** |

E, sobretudo, a treliça em losango **desapareceu da imagem** — que é o
defeito que se estava perseguindo.

### 10. O que a revisão de código encontrou — e o pior era meu

Rodei `/code-review` sobre os dez commits da sessão. Onze achados. O
primeiro invalida uma coisa que eu havia declarado verificada:

**A junta de sombra nunca renderizou.**

    piso:   box(13,9 / 0,12 / 12) em y = 0,06   ->  topo em 0,12
    junta:  altura 0,04 em y = 0,09             ->  de 0,07 a 0,11

Inteiramente dentro da laje. Não apareceu em quadro nenhum — e eu tinha
olhado a captura, visto a sombra do encontro parede/piso e lido como
sendo a peça. **A sombra sempre esteve lá; a peça não.** Vi o que
esperava ver, que é exatamente o modo de falha que este relatório
persegue desde a primeira página.

A correção veio com prova que não é visual: sondando o grafo, a caixa da
junta agora vai de **y 0,120 a 0,160**, acima do topo do piso — e é uma
malha só, porque a fusão por material juntou as sete corridas.

**E a sanca saiu inteira.** A revisão mostrou que eu havia construído um
sistema paralelo ao `createCoveLight`, que já existia — e pior:

| o que eu fiz | por que estava errado |
|---|---|
| `matLed` sem `envMapIntensity` | a fita de `createCoveLight` fixa `0` com o comentário *"era isso que a deixava branca de dia"*. Reproduzi um defeito já consertado |
| sanca da suíte em z −5,99…−5,87 | **engolia** o `headCove` em (6,5 / 3,02 / −5,86): a fita parava de brilhar com a testeira ainda aparecendo |
| sanca na parede norte da sala | ficava paralela à `cove` que já existia em z −5,7 — duas fitas na mesma parede |
| sanca em y 3,06 na partição | a partição tem **3,0 m**, não 3,2: a peça flutuava acima do topo dela |

Agora: paredes que já tinham cove ganham só a junta; as que não tinham
ganham cove **pela função existente**, na mesma altura das demais (3,02).
Duas alturas de rasgo na mesma casa leem como erro de obra.

Os demais achados corrigidos:

- **`chapterCamMove` não caía no caminho de corte.** Voo seguido de corte
  deixava a flag ligada, e o `lerpCam()` seguia perseguindo a câmera
  através da fachada durante o fade, com o `clampFreeCamera()` isento.
- **O voo de capítulo não desligava o orbit**, mas a chegada religava — o
  amortecimento do `OrbitControls` disputava a câmera com o `lerpCam()`
  no percurso inteiro. `toggleReveal()` já desligava, pelo mesmo motivo.
- **O costurador do HTML único embutia o bundle como *string* de
  substituição.** Em `String.replace`, `$&`, `` $` ``, `$'` e `$$` são
  padrões: um cifrão perdido em 1,3 MB de three.js reinjetaria o trecho
  casado e truncaria o script num `SyntaxError` — com a conferência de
  referência absoluta passando do mesmo jeito. Latente, mas latente não é
  inexistente. Agora entra por função de substituição.
- **O painel de debug tinha `/11 etapas` escrito à mão** e passou a
  mostrar "12/11" assim que uma etapa foi acrescentada. Agora conta do
  próprio array.
- **A bancada do gramado usava `opts: {}` como controle "ATUAL"** — ou
  seja, media a configuração que a cena já não envia. Uma bancada cujo
  controle não é o código mede outra coisa.

### A transição de luz, em três versões

Vale isolado porque é o mesmo defeito reaparecendo três vezes, cada uma
sobrevivendo a uma correção:

| versão | fórmula | por que ainda estava errada |
|---|---|---|
| v1 | `e += 0.016 / dur` | 60 fps cravados no código |
| v2 | `e += min(dt, 0.05) / dur` | o teto prende ao quadro abaixo de 20 fps: a 10 fps, 1,8 s vira 3,6 s |
| **v3** | `e = (agora − início) / dur` | relógio de parede, sem teto |

O teto da v2 parecia prudência — impedir que uma engasgada desse um salto
na luz. Mas depois de travar dois segundos, a luz **deve** estar dois
segundos adiante, não dois atrasada. O salto era o comportamento certo, e
eu o tinha tratado como defeito.

### 11. Os oito capítulos que eu nunca tinha olhado

Até aqui eu tinha inspecionado quatro enquadramentos. Sobravam oito que o
cliente vê e eu nunca tinha visto.

Uma armadilha do instrumento antes dos defeitos: chamei `goToChapter`
(que inicia um voo por curva) e em seguida setei a câmera à mão.
`lerpCam` sobrescreve com `camCurve.getPointAt(e)`, e a captura saía a
**24 m do alvo** — não era o enquadramento do capítulo. Deixando o voo
convergir, o erro final ficou entre 0 e 0,5 m.

**Corrigidos:**

- **A porta de entrada lia como retângulo preto com um pontinho** — e
  isso no capítulo "Chegada", o primeiro quadro que o cliente vê. Não era
  material: é cumaru com moldura de metal, mas fica 23 cm dentro do
  portal de pedra, em sombra própria. Madeira escura sem luz vai a preto,
  e isso é fisicamente correto — não se conserta clareando o material.
  Conserta-se dando à porta o que a faz legível na sombra: junta vertical
  de sombra e puxador vertical de 1,36 m. A alavanca anterior tinha 13 cm
  e, vista de frente a doze metros, ocupava menos de um pixel.
- **O vaso de planta era um icosaedro cru** — `IcosahedronGeometry(0.42,
  0)`, 20 faces, vestido com material de copa, a dois metros da câmera no
  capítulo "Paisagismo". É o mesmo defeito que este arquivo já condena em
  `boulderGeometry` ("lia como gema de jogo"), sobrevivendo num objeto
  mais próximo do olho que as pedras. Agora são 16 cartões de alfa
  recortado.
  *Errei o conserto na primeira tentativa*: a massa ficou **flutuando**
  35 cm acima do bordo, porque mantive o centro do icosaedro e encolhi a
  extensão vertical. Corrigido descendo a distribuição abaixo do equador —
  que também é o certo: folha de vaso tomba sobre a borda.
- **Rodapé duplicado na suíte**, e este é meu. A revisão pegou a
  duplicação na sala; esta eu deixei passar. Removido. `createBaseboardRun`
  agora não tem nenhum chamador.

**Achados, medidos, NÃO corrigidos:**

- **A colina distante é 7,2× mais clara que as árvores à frente dela, à
  noite.** No capítulo "Visão Final":

  | região | distância | média | R / G / B |
  |---|---|---|---|
  | céu | — | 8,0 | 0 / 5 / 59 |
  | colina | 225–435 m | **38,3** | 30 / 43 / 20 |
  | árvores | 46–218 m | **5,1** | 0,5 / 7 / 0,4 |

  É a mesma inversão de perspectiva aérea que foi corrigida para o dia.
  **Minha primeira hipótese estava errada e a medição a derrubou:** pela
  aritmética dos canais eu concluí que a névoa não chegava às colinas.
  Ligando e desligando `fog` no material em tempo de execução, a região
  vai de 38,3 para 56,6 — a névoa chega. O que sobra é que elas são a
  maior superfície voltada para cima da cena e recebem hemisférica 0,85 +
  ambiente 0,18 à noite. Corrigir isso sem escurecer o jardim (que lê
  bem) exige tratamento dependente da hora, e não entrei nele.
- **A ilha da cozinha é uma caixa creme sem portas, gavetas, puxadores
  nem rodapé.** Mesmo padrão dos rodapés: o mobiliário está blocado, não
  detalhado. Capítulo "Cozinha & Jantar".
- **A fachada norte continua um plano branco extenso** com manchas largas
  da variação macro que leem como umidade. O comentário do código diz que
  isso foi resolvido com portal, rasgos e brise — resolveu em parte; a
  área entre os elementos continua vazia.
- **Vão preto no Terraço Superior**: ~25% do quadro em preto absoluto na
  hora dourada.

### Erro meu de leitura, registrado para não voltar

- **Erro meu de leitura, registrado para não voltar:** capturei a piscina
  em `applySolarTime(0.72)` chamando o resultado de "golden hour", e saiu
  quase noite. Não é defeito do produto —
  `SOLAR_T = { day: 0, golden: 0.52, blue: 0.76, night: 1.00 }`. O 0,72
  está a um passo da *blue hour*, e a sonda confirma: a 0,72 o sol está em
  0,654 contra 4,637 ao meio-dia (14%), e a névoa já é `#586380`. A
  progressão de névoa medida é coerente e bem calibrada:
  `#dfe2e3` (dia) → `#586380` (crepúsculo) → `#1b2740` (noite), com a
  densidade quase constante em ~0,0034. Para julgar a golden hour de
  verdade é preciso `setLightMode('golden')` ou `applySolarTime(0.52)`.

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

## Situação de cada área, sem arredondar

Classificação exigida: DONE / PARCIAL / BLOQUEADO / NÃO MEDIDO. Um item só
é DONE se existe uma medida que o comprove.

| área | situação | o que sustenta |
|---|---|---|
| Cobertura lendo como água | **DONE** | razão B÷R de 1,35 → 0,90 na mesma superfície |
| Perspectiva aérea com degrau | **DONE** | maior salto de névoa entre faixas povoadas: 20,9 → 7,1 pontos |
| Galhos como varas contra o céu | **DONE** | 38,3% → 0,4% das pontas fora da copa (200 mil árvores simuladas) |
| Barra de capítulos (interno) | **DONE** | expulso a 29,02 m → para em 0,09 m e fica aos 45 s |
| Barra de capítulos (voo externo) | **DONE** | não saía do lugar → chega a 0,00 m e fica |
| Poeira lendo como neve | **DONE** | teto de 6 px no `gl_PointSize` (era 51 px a 1 m), mais fade de perto |
| Transição de luz contando quadros | **DONE** | `0,016/quadro` → relógio real; a 30 fps durava o dobro do pedido |
| Anti-aliasing, cáusticas, feixes, áudio, Modo Seção, fallback | **DONE** | seções anteriores deste relatório |
| Núcleo em pedra lendo como bloco | **DONE** | ablação: a junta sozinha causava a leitura; 3 → 10 fiadas troca alvenaria por estratificação |
| Trama regular no gramado | **DONE** | não era o normal map: eram as manchas do ladrilho difuso; 0,2556 → 0,2080 e a treliça sumiu |
| Determinismo da cena | **DONE** | duas cargas com soma das 5002 matrizes de instância idêntica (171347,886) |
| Acabamento interno (junta de sombra) | **DONE** | as sete corridas seguem as paredes de `buildArchitecture`; caixa provada em y 0,120–0,160, acima do piso em 0,12 |
| Cove nas paredes que não tinham | **DONE** | pela `createCoveLight` existente, em 3,02 — sem sistema paralelo |
| Estouro do interior noturno | **PARCIAL** | bloom por local: 41,3% → 27,6% da parede acima de 240. O resíduo é luz direta das 9 luminárias e só zera desligando-as |
| Fachada, paisagismo e interface (blocos 2–4) | **NÃO INICIADO** | o acabamento pedido cobre quatro áreas; só a primeira foi feita |
| Desempenho (FPS, tempo de quadro) | **NÃO MEDIDO** | esta máquina não tem GPU |
| Galeria 360° | **BLOQUEADO** | não há panorama nenhum no repositório |
| Supabase | **BLOQUEADO** | conta consultada pelo conector: **zero projetos**. Criar é ação cobrada, na conta do Thiago |
| KTX2, PMREM assado, BatchedMesh, BVH, SSR, TAA, LOD de vegetação, lightmaps, culling por portais | **NÃO INICIADO** | escopo original, nunca começado |

**O que isto NÃO é.** Não é "o prompt implementado". Seis defeitos foram
encontrados medindo e corrigidos com medida; um foi encontrado, atacado
duas vezes, piorado duas vezes e revertido; dois estão reproduzidos e sem
correção; três estão bloqueados por dependência externa; e a lista de
otimizações do escopo original continua sem começar. A linha de base de
desempenho tem contagem de objetos, de chamadas e de triângulos — não tem
FPS, e não vai ter enquanto rodar aqui.

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

---

# 12. RODADA P0 — CINTILAÇÃO, TEMPO DE QUADRO, CÂMERA, APRESENTAÇÃO

Esta seção cobre a rodada de finalização, dirigida aos quatro
bloqueadores declarados: cintilação visível, estabilidade de tempo de
quadro, estabilidade de câmera e Modo Apresentação.

Todo número abaixo é medido. Esta máquina **não tem GPU** (SwiftShader,
~0,1 quadro/s), então nenhum FPS é reportado, e o que se mede é
geometria, estado do pipeline e comportamento de laço — coisas que não
dependem de rasterização rápida.

## 12.1 A câmera não treme — MEDIDO E DESCARTADO

A primeira hipótese era a mais óbvia: `clampFreeCamera()` reescreve
`camera.position` todo quadro depois de `controls.update()`, e o
OrbitControls tem amortecimento. Dois donos do mesmo transform brigando
produziriam tremor.

`clampFreeCamera`, `pointInEnvelope` e `HOUSE_ENVELOPE` passaram a ser
exportados justamente para poder exercitar esse laço sem desenhar (aqui
um quadro custa dez segundos; mil iterações do laço custam
milissegundos). 240 iterações, quatro cenários:

| cenário | salto máximo | salto médio | período-2 |
|---|---|---|---|
| parado, externo | 0,000 mm | 0,000 mm | 0,000 mm |
| empurrando contra a fachada leste | 0,000 mm | 0,000 mm | 0,000 mm |
| empurrando abaixo do piso | 0,000 mm | 0,000 mm | 0,000 mm |
| rasante à fachada norte | 0,000 mm | 0,000 mm | 0,000 mm |

Zero em todos. A hipótese está **descartada com medida**, não com
opinião.

## 12.2 O pipeline de profundidade está saudável — MEDIDO

A segunda hipótese era precisão de profundidade: `near = 0,1` e
`far = 500` é razão 5000, e os alvos do composer poderiam ter buffer de
16 bits (o Three.js só usa `DEPTH_COMPONENT24` em WebGL 2).

Lido em tempo de execução:

    webgl2 ....................... true
    bits do framebuffer padrão ... 24
    alvo1 do composer ............ 1280x800, amostras 4, stencil true
    alvo2 do composer ............ 1280x800, amostras 4, stencil true

Resolução do buffer de 24 bits com este near/far:

| distância | 1 m | 5 m | 20 m | 50 m | 100 m | 200 m |
|---|---|---|---|---|---|---|
| resolução | 0,001 mm | 0,015 mm | 0,24 mm | 1,5 mm | 6,0 mm | 23,8 mm |

Dentro da casa a resolução é submilimétrica: só coincidência EXATA
brigaria. **Mexer em `near`/`far` seria mexer no lugar errado**, e a
correção do MSAA e do stencil (seção 5) está confirmada aplicada em
tempo de execução, não só no código.

## 12.3 A causa raiz: o gramado do lote atravessava o relevo por 10,9 m

Detector de z-fighting no nível do triângulo: todo triângulo de toda
malha opaca em coordenadas de mundo, filtrado para os paralelos a um
eixo, agrupado por eixo + plano + **sentido da normal**. O sentido é o
que separa defeito de contato — duas faces no mesmo plano apontando para
lados opostos são uma peça apoiada na outra, e o back-face culling
resolve; apontando para o mesmo lado, as duas são desenhadas e o buffer
escolhe por pixel.

O pior par: disco de gramado do lote contra o campo distante, folga
0 mm, ambas as faces para cima. Avaliando `farGroundHeight` sobre o raio
do disco:

    relevo do campo distante dentro de r <= 130 m
      mínimo -2,329 m   máximo +8,556 m   AMPLITUDE 10,886 m

O disco era um **plano** em y = -0,06 com 130 m de raio, e a rampa de
relevo do terreno começa em 42 m. De 42 m para fora o terreno
**atravessa** o gramado. Isso ocupa a faixa média de toda vista externa.

A correção deslocou o disco pelo mesmo campo de altura, com folga
dimensionada (o campo distante é malha de 96 segmentos, e a superfície
dele chega a ficar 55 mm acima da função que a define). Prova, amostrando
dentro dos triângulos do disco novo:

| faixa de raio | folga mínima | margem sobre o buffer |
|---|---|---|
| 0–25 m | 20,0 mm | 54x |
| 25–42 m | 23,0 mm | 22x |
| 42–70 m | 66,4 mm | 23x |
| 70–100 m | 90,2 mm | 15x |
| 100–130 m | 97,5 mm | 10x |

O gramado continua em y = -0,0600 exatos até r = 25 m: nada perto da casa
se moveu.

## 12.4 A mata e os morros estavam apoiados no ESPELHO do terreno

Achado conferindo a matemática de quem consome `farGroundHeight`.
`farGroundMesh` é um plano girado -90° em X e posto em z = 4, então o
vértice de mundo (x, ·, wz) usa `farGroundHeight(x, 8 - wz)`. A vegetação
distante e os morros chamavam `farGroundHeight(x, z)` com o z de mundo.
Os dois campos só coincidem em wz = 4.

| anel | erro médio | erro máximo |
|---|---|---|
| mata próxima (46–120 m) | 1,97 m | 9,48 m |
| mata média (120–220 m) | 6,11 m | 14,48 m |
| mata distante (220–300 m) | 6,19 m | 14,46 m |
| morros 1 (225–320 m) | 6,17 m | 14,43 m |
| morros 2 (340–435 m) | 5,44 m | 13,36 m |

Seis metros de erro médio: metade da mata de fundo flutuando, a outra
metade enterrada, em toda vista externa. Corrigido nos consumidores e não
na malha — a silhueta do horizonte foi calibrada renderizando, e girá-la
agora seria trocar um defeito medido por uma regressão não medida.

## 12.5 O teto de tempo da pré-compilação era decorativo

O projeto não tinha nenhuma pré-compilação de shader. A primeira versão
usou `compileAsync` com corrida contra um relógio de 9 s. Medido:

    58 -> 99 programas em 37 578,9 ms, com teto declarado de 9 000 ms

O teto não segurou nada, e a fonte do Three.js diz por quê:
`compileAsync` chama `compile()` de forma **síncrona** e só depois
devolve a Promise que espera o driver. Sem
`KHR_parallel_shader_compile` o trabalho todo acontece com a thread
travada, e o `Promise.race` nunca é avaliado. Agora a compilação vai em
pedaços de 8 objetos, cedendo um quadro entre eles, com orçamento real de
6 s.

## 12.6 O que ainda não tem número

- **Tempo de quadro em hardware real.** `UNMEASURED — REQUIRES TARGET
  HARDWARE`. O que existe agora é o instrumento: anel dos últimos 600
  quadros com p50/p95/p99/pior e contagem de engasgos (quadro acima de 2x
  a mediana), no console de debug e na telemetria. Média de FPS saiu de
  cena como métrica principal — ela esconde exatamente o defeito que o
  cliente relatou.
- **Inspeção visual das correções.** `UNTESTED`. Nenhuma captura foi
  feita depois das correções de terreno; o que existe é prova geométrica
  e numérica.

## 12.7 A causa raiz do Modo Apresentação: cada plano terminava de costas

Achado depois, e é a causa direta do relato "o Modo Apresentação mostra a
paisagem em vez da casa".

`Object3D.lookAt()` e `Camera.lookAt()` produzem quaternions **opostos**,
de propósito: um objeto comum aponta o +Z dele para o alvo (o que faz
sentido para uma seta, um cartão de folha, um holofote); uma câmera olha
pelo −Z. O próprio Three.js troca os argumentos de `Matrix4.lookAt`
conforme `this.isCamera`.

O CameraDirector calculava a orientação final de cada plano com um
suporte `new THREE.Object3D()` e copiava o quaternion dele para a câmera.

Medido com a pose real do plano "Chegada" (olho 18/7,5/16, alvo −1/4,2/0):

| suporte | frente resultante | erro angular |
|---|---|---|
| direção correta câmera→alvo | −0,758 / −0,132 / −0,639 | — |
| `Object3D.lookAt` | +0,758 / +0,132 / +0,639 | **180,00°** |
| `PerspectiveCamera.lookAt` | −0,758 / −0,132 / −0,639 | 0,00° |

**Por que o sintoma era intermitente** e não uma tela sempre errada: em
cada plano a orientação faz slerp de `quatInicio` — a orientação REAL da
câmera naquele instante, que está certa — até `quatFim`, calculado pelo
suporte e 180° errado. O plano **começa enquadrado e vai girando até
terminar de costas para a casa**, mostrando céu e o relevo de fundo. É
exatamente o relato, e explica por que "às vezes" e não "sempre".

Nada corrigia isso depois: `controls.update()` — que faria
`object.lookAt(target)` na câmera, pelo ramo certo — fica fora do laço
enquanto `__auraCameraTravada` está ligado, que é precisamente durante a
apresentação.

Correção: `new THREE.Camera()`. Ela tem `isCamera = true`, então `lookAt`
toma o ramo certo. Não é um `Object3D` com um comentário pedindo cuidado
— é o tipo que já carrega a semântica.

**Como o defeito apareceu.** O mesmo erro estava no validador de planos
escrito nesta rodada, e foi ele que denunciou: o validador devolvia
cobertura 0,000 para TODOS os planos externos e 1,000 para os dois
internos. Zero e um, nunca um valor no meio — a assinatura de uma câmera
girada 180°: de fora ela olha para o céu e não acerta nada; de dentro ela
olha para a parede oposta e acerta tudo. Um instrumento quebrado do mesmo
jeito que o código de produção é, por acidente, um bom detector.

## 12.8 Duas vezes o mesmo erro de método: caixa envolvente

Vale registrar porque custou duas rodadas de medição errada.

**No detector de z-fighting.** A primeira versão comparava AABBs. Boa
parte das malhas desta cena é geometria FUNDIDA — um merge por material
junta o terraço sul com o piso do quarto — e a caixa de um merge cobre
metade do lote. Duas malhas fundidas quaisquer "compartilham o plano
y = 0" sem que nenhuma superfície delas esteja perto de outra. A sonda
reportou 250 m² de faces coincidentes que não existiam.

**No validador de planos.** O teste "câmera dentro de sólido" era ponto
contra AABB. O plano "A fachada", com a câmera a 7 m ao sul da casa sobre
o deck, era reportado como estando dentro de SEIS sólidos. Todos falsos,
pela mesma razão.

Os dois foram trocados por medidas que olham a superfície de verdade:
rasterização dos triângulos por plano no primeiro, seis raios nos eixos
no segundo. Depois da troca, o total de área em risco de z-fighting caiu
de 534 723 m² (fantasia) para 15,25 m² reais, todos em faces voltadas
para BAIXO e ocluídas pela laje logo abaixo.

## 12.9 Defeitos desta rodada, em ordem de gravidade

Nove defeitos, todos encontrados por medição ou por leitura da fonte —
nenhum por palpite. Os três últimos vieram do passe de red-team sobre as
próprias correções desta rodada.

| # | defeito | como apareceu | tamanho medido |
|---|---|---|---|
| 1 | Apresentação terminava cada plano **de costas** para a casa | validador dando 0 ou 1, nunca no meio | **180,00°** de erro angular |
| 2 | Gramado do lote **atravessava** o relevo | detector de z-fighting por triângulo | **10,886 m** de amplitude |
| 3 | Mata e morros apoiados no **espelho** do terreno | conferindo a matemática de `farGroundHeight` | **6,1 m** médios, 14,5 m máx |
| 4 | Aba oculta **travava o boot para sempre** | red-team da pré-compilação | rAF não dispara em aba oculta |
| 5 | Lente do dolly zoom **vazava** para os 6 planos seguintes | percorrendo o filme plano a plano | 54,67° em vez de 40° |
| 6 | `lerpCam` do legado escrevia na câmera **durante o corte** | leitura de `animate()` | 18 quadros de arrasto a 60 Hz |
| 7 | Mata distante **fora** das duas correções de cintilação | red-team | anéis de 46 a 435 m |
| 8 | Dois fades sobrepostos **abriam a tela na pose antiga** | red-team | teleporte visível em t≈360 ms |
| 9 | Clique de "Apresentação" **sumia** durante um fade da FSM | medindo: o diretor ficava em `indice: -1` | janela de ~400 ms |

E dois erros de método meus, corrigidos no caminho: caixa envolvente para
descrever geometria fundida (duas vezes — no detector de z-fighting e no
validador) e um teto de tempo que não segurava nada porque `compileAsync`
compila de forma síncrona.

## 12.10 Matriz de conclusão

| item | estado | prova |
|---|---|---|
| Modo Apresentação enquadra a casa | **DONE** | erro de mira 0,00–0,01° no fim dos 8 planos; cobertura por plano medida com 25 raios |
| Câmera estável na exploração livre | **DONE** | 240 iterações × 4 cenários, salto máximo 0,000 mm |
| Z-fighting no terreno | **DONE** | folga 20–176 mm lida dos vértices na GPU; margem 10–54× sobre o buffer |
| Vegetação apoiada no terreno | **DONE** | `alturaDoCampo` bate com a malha por construção |
| Cintilação de textura (anisotropia) | **DONE** | varredura da cena, não mais lista à mão |
| Cintilação de borda de folha | **DONE** | alpha-to-coverage em todo material com `alphaTest` na cena |
| Determinismo da cena | **DONE** | zero `Math.random()` em módulo tipado |
| Pré-compilação de shader | **DONE** | 58 → 99 programas; orçamento real de 6 s; sem travar aba oculta |
| Instrumento de tempo de quadro | **DONE** | p50/p95/p99/pior + engasgos, no console e na telemetria |
| **Tempo de quadro em hardware real** | **UNMEASURED** | esta máquina não tem GPU (SwiftShader, ~0,1 quadro/s) |
| **Inspeção visual das correções** | **UNTESTED** | mesma razão; toda prova aqui é geométrica ou numérica |
| Blocos de acabamento (fachada, paisagismo, interface) | **NÃO INICIADO** | a rodada foi inteira nos bloqueadores P0 |
| Ilha da cozinha sem frentes/puxadores | **ABERTO** | medido em rodada anterior, não corrigido |
| Noite: 27,6% dos pixels de parede acima de 240 | **ABERTO** | medido, não corrigido |
| Galeria 360° | **BLOCKED BY EXTERNAL DEPENDENCY** | não há panorâmicas no repositório |
| Persistência (Supabase) | **BLOCKED BY EXTERNAL DEPENDENCY** | conector sem projeto; criar um é ação paga na conta do Thiago |
