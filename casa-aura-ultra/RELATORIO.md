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

**Modo Corte com stencil.** O "Modo Corte" herdado ergue o volume superior
— funciona e é convincente. O corte por `THREE.Plane` com stencil e
wireframe nas paredes cortadas não foi feito. Bloqueio: nenhum; é escopo
não iniciado.

**Supabase.** A migração `supabase/migrations/0001_casa_aura.sql` está
escrita e **não foi aplicada**. A organização existe e tem zero projetos;
criar um é ação cobrada e externa, então não fiz por conta própria.
Próxima ação: você cria o projeto e eu aplico a migração e ligo o cliente.

**Não iniciados**, do escopo original: KTX2/Basis, PMREM pré-assado,
`BatchedMesh`, BVH, SSR, TAA, LOD/impostores de vegetação, lightmaps
assados, culling por portais, `AssetManager`/`InputManager` como módulos
próprios, `src/shaders/*.glsl` em arquivos separados (o GLSL está
embutido nos módulos de efeito, com os prefixos `casaAura_` exigidos).

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
