# Casa Aura — pipeline técnico

Documentação de como o projeto é construído, testado e estendido.
Escrita para quem for continuar o trabalho (ou para você retomar daqui a
seis meses).

---

## 1. O que é o entregável

`CASAAURAV9.html` — **um arquivo só**, ~219 KB, que roda direto do
sistema de arquivos.

A restrição de arquivo único não é preferência estética: o arquivo é
aberto no Android a partir de `content://downloads`, e nesse esquema
caminho relativo não resolve. Por isso a cena inteira (geometria,
texturas, shaders) é **procedural** — gerada em JavaScript no
carregamento, sem nenhum asset externo obrigatório.

O único recurso de rede obrigatório é o Three.js via CDN
(`unpkg.com/three@0.160.0`). Se ele não carregar, a página mostra uma
mensagem honesta em vez de um loader travado (ver o script de detecção
no `<head>`).

### O que é opcional e carregado sob demanda

| Caminho | Quando carrega | Para quê |
|---|---|---|
| `assets/models/embedded-models.js` | só com `?models=1` | mobiliário modelado no Blender (GLB base64) |
| `assets/models/*.glb` | nunca automaticamente | os mesmos modelos soltos, para reabrir no Blender/SketchUp |
| `assets/textures/*` | tentativa silenciosa no boot | texturas PBR que substituem as procedurais |

Nada disso é necessário. A ausência é o caminho normal.

---

## 2. Parâmetros de URL

| Parâmetro | Efeito |
|---|---|
| `?debug=1` | painel com FPS, draw calls, triângulos, tier, etapas do build |
| `?q=ultra\|high\|medium\|low` | trava o tier e **desliga o rebaixamento automático** |
| `?models=1` | usa os GLB do Blender no lugar do mobiliário procedural |

`?q=` existe por uma razão de engenharia: sem ele não há como auditar um
tier específico, porque num renderizador lento o rebaixamento automático
dispara e o que se audita acaba sendo sempre `low`.

---

## 3. Tiers de qualidade

Escolhidos por `Quality.init()` a partir de `deviceMemory`,
`hardwareConcurrency` e user agent; rebaixados em tempo real se o FPS
ficar abaixo de 24 por 3 segundos seguidos.

| Tier | DPR | Sombras | Vidro | Água | Pós-processamento |
|---|---|---|---|---|---|
| ultra | ≤2 | 2048 | transmission | Water.js 512 | GTAO + Bloom + grade |
| high | ≤1.75 | 1024 | transmission | Water.js 256 | GTAO + grade |
| medium | ≤1.5 | 512 | opaco/alpha | material simples | grade |
| low | 1 | off | opaco/alpha | material simples | nenhum |

---

## 4. Arquitetura do código

O arquivo é linear e agrupado por assunto. Os blocos que importam:

**Infraestrutura**
- `BuildTrace` — rastreia qual etapa do build está rodando; é o que
  distingue "WebGL indisponível" de "nosso código quebrou".
- `Capability` / `Quality` — detecção e tiers.
- `Experience` — máquina de estados (`loading → ready → explore →
  cinematic|presenting → commercial`).
- `createAssetSystem()` — carregamento opcional de texturas/modelos.

**Materiais e texturas (tudo procedural, em `<canvas>`)**
- `woodGrainTexture`, `stoneVeinTexture`, `paverTexture`,
  `grassTexture`, `stuccoNoiseTexture`, `gravelTexture`
- `leafCardTexture`, `grassBladeCardTexture`, `barkTexture` — vegetação
- `noiseNormalTexture` — normal maps de ruído em 3 oitavas
- `applyMacroVariation(mat, escala, força)` — dissolve o padrão de
  ladrilho modulando a cor difusa por ruído em espaço de mundo
- `applyWorldUV(geo, w, h, d)` / `TILE_M` — UV proporcional ao tamanho
  real, para que a mesma textura tenha a mesma escala num puxador e numa
  fachada

**Iluminação**
- `LP` — 4 paradas atmosféricas (day / golden / blue / night)
- `SUN_KEYS` — arco solar com chaves próprias de azimute e elevação
- `solarStateAt(t)` — interpola tudo continuamente entre paradas
- `applySolarTime(t)` — aplica sol, céu, névoa, exposição, IBL e o
  acendimento escalonado das luminárias
- `applyEnvIntensity(k)` — escala o `envMapIntensity` de todos os
  materiais ao longo do dia

**Geometria**
- `sharedBox` / `sharedCyl` / `sharedRoundedBox` — cache de geometria
- `buildInstanced(geo, mat, transforms, castShadow)` — InstancedMesh
- `emitTree` / `emitShrub` / `emitGrassTuft` / `pushCard` — vegetação
- `mergeStaticByMaterial(root, label)` — fusão de malhas estáticas

**Cena**
- `buildArchitecture`, `buildLivingRoom`, `buildDining`, `buildKitchen`,
  `buildPrimarySuite`, `buildUpperLevel`, `buildPoolAndDeck`,
  `buildLandscaping`, `buildDistantLandscape`, `buildGround`

---

## 5. As três otimizações que sustentam a performance

**Instancing.** Toda vegetação é `InstancedMesh`. Uma árvore de 22
cartões de folha não custa draw call próprio — custa 22 matrizes num
buffer. Hoje são ~2.700 instâncias em 6 meshes.

**Fusão estática** (`mergeStaticByMaterial`). Dentro de cada grupo que se
move junto, malhas estáticas de mesmo material viram uma só.
Medido: **1199 → 510 draw calls**.

Ficam de fora de propósito:
- `InstancedMesh` (já é 1 chamada);
- material transparente (a ordenação por objeto é o que faz vidro, água
  e sombra de contato aparecerem na ordem certa);
- objetos com `onBeforeRender` próprio — o `Water.js` é o caso concreto,
  ele renderiza a cena num render target e refletiria nada se fundido;
- `userData.mergeRoot` — o volume superior do Modo Corte precisa
  continuar podendo subir sozinho.

Para blindar um objeto novo contra a fusão: `obj.userData.noMerge = true`.

**Orçamento de luzes.** `MeshStandardMaterial` avalia todas as luzes por
fragmento. `addFixture()` cria `PointLight` real só enquanto há
orçamento (`LIGHT_BUDGET` por tier: 6/4/2/1); o resto fica apenas como
material emissivo, que custa zero.

É esse orçamento que explica `applyUplightWash()`. A luz de fachada à
noite é o que dá relevo ao edifício depois que o sol some, mas gastar 8
`PointLight` nela consumiria o orçamento inteiro — a versão anterior do
projeto já havia cortado os uplights de 8 para 1 por isso. A lavagem é
então calculada **dentro do material**: por ponto de luminária, um
decaimento radial em XZ e um decaimento vertical ao quadrado a partir da
base, somados em `totalEmissiveRadiance`. Custa algumas instruções por
fragmento em dois materiais (`estuque`, `stoneCore`) e não entra no
orçamento. Em `medium`/`low` usa metade dos pontos — o laço é desenrolado
no shader, então o número de pontos é literalmente o de iterações.

---

## 6. Ambiente de teste visual (`.devtest/`)

Este é o item que muda como o projeto é desenvolvido: dá para **ver** o
resultado em vez de supor.

```bash
cd .devtest
npm install three@0.160.0        # unpkg é bloqueado em alguns ambientes
npx http-server -p 8099 -s .     # serve .devtest como raiz
node mkpage.mjs                  # gera index.html a partir do HTML de produção
```

`mkpage.mjs` reescreve o importmap para `node_modules` e injeta
`window.__AURA` com ganchos de teste. **O arquivo de produção não muda** —
o que a captura mostra é o que o arquivo real renderiza.

Ele também **valida a sintaxe da página gerada** antes de gravar, e sai
com código 1 se falhar. Isso existe por experiência: um escape errado
dentro do gancho injetado torna a página inteira JS inválido, e o sintoma
que aparece minutos depois é `módulo não expôs __AURA` — que parece
defeito da cena, não do teste. Rodar `node --check` no arquivo de
produção não pega: quem precisa ser válido é o que o navegador carrega.

| Script | Para quê | Custo |
|---|---|---|
| `probe.mjs` | draw calls, triângulos, contagem de objetos, erros de console | segundos |
| `tune.mjs` | varre parâmetros de luz e mede histograma em uma única carga | segundos por combinação |
| `shoot.mjs` | grava PNG de cada câmera de capítulo | ~1-3 min por imagem |

```bash
node probe.mjs
AURA_TUNE='[{"sunI":2.4,"envI":0.45,"exp":0.85}]' node tune.mjs
AURA_ONLY=ch00,ch08 node shoot.mjs saida/
```

O navegador é Chromium real com SwiftShader — **WebGL 2 de verdade**, o
que permite validar GTAO e bloom (as sessões anteriores tinham só WebGL
1 e por isso não conseguiram testar o pós-processamento).

SwiftShader é software: 1-3 minutos por captura é normal e não diz nada
sobre o desempenho em GPU real. Para medir performance, use
`renderer.info` via `probe.mjs`, não o FPS do headless.

### Calibrar luz por número, não por impressão

`tune.mjs` mede, para três enquadramentos, luminância média, % de pixels
estourados, % quase pretos e desvio de azul (B−R). Critério usado:

- estouro < 1% na fachada em sombra e no interior;
- B−R abaixo de ~8 (acima disso a cena "azula");
- o céu estourar ~12% é aceitável — foto de dia claro estoura o céu.

---

## 6b. Escala de textura — a regra que custou uma rodada

O gerador PBR (`heightField` → `pbrFromHeight`) deriva cor, normal,
rugosidade e AO do mesmo campo de altura. A primeira calibração errou
feio, e o erro vale registrar porque é contraintuitivo:

**Detalhe fino demais não vira textura — vira ruído.**

Com `TILE_M = 1,6 m`, uma textura de 512 px tem ~3 mm por texel. Pedir 5
oitavas a partir de frequência 10 produz feições de ~1 cm. A 3 m de
distância isso está abaixo do que o olho resolve *e* abaixo do que o
mipmap consegue filtrar sem cintilar: a parede de estuque leu como lixa.

A regra prática que ficou:

| Superfície | Feição visível a 2-4 m | Oitavas / freq base |
|---|---|---|
| Reboco fino | ondulação de 20-50 cm | 3 oitavas, base 3 |
| Travertino | poro e leito de 5-15 cm | 5 oitavas, base 3 |
| Alvenaria | fiada de 20-40 cm | junta esculpida + 4 oitavas, base 6 |

E dois valores que estouram fácil:

- **rugosidade**: `roughBase - roughVar` é o piso real. Com 0,46 e 0,34 as
  saliências caem em 0,12 e o piso vira espelho, lendo como molhado.
- **albedo**: concreto a 0,75 estoura ao sol. Concreto real fica em
  0,45-0,55; travertino claro em 0,7-0,8.

Junta de alvenaria é caso à parte: precisa ser **escavada no campo de
altura** (`carveCourses`), não desenhada na cor. Junta que existe só no
albedo lê como adesivo, porque o relevo e a sombra não a acompanham.

## 7. Defeitos que só apareceram renderizando

Registro do que a auditoria visual encontrou — todos invisíveis na
leitura do código, todos corrigidos. Serve de aviso: neste projeto, ler
o código não substitui olhar a imagem.

| Defeito | Como apareceu | Causa |
|---|---|---|
| Piscina sem água | raycast na câmera do capítulo | a borda era uma **laje maciça** de 10,6 × 5,4 m cobrindo a piscina; a água ficava 9 cm abaixo |
| Fundo da piscina plano | mesma câmera | os 6 segmentos do casco tinham o **topo sempre na mesma cota**; o desnível existia só para baixo, invisível |
| Degraus submersos invisíveis | consequência do acima | estavam dentro do bloco maciço — geometria morta |
| Deck atravessando a piscina | só apareceu depois de abrir a bacia | o deck era uma laje inteiriça de 15 × 8,5 m e a piscina fica **dentro** dessa pegada |
| Deck de ipê refletindo o céu | raycast (`matAt`) — a "chapa branca" era o deck, não a água | `roughnessMap` marcado como **sRGB**: #888 vira 0,247 em linear e o Three.js multiplica → roughness 0,16 em vez de 0,66 |
| Madeira sempre brilhante demais | medição no deck (5,45% estourado) | base do `roughnessMap` em cinza-médio **divide** a rugosidade; num mapa de rugosidade, branco = rugosidade cheia |
| Relevo do horizonte invisível | panorâmica | os morros ficavam em y = −9 a −13 com o topo em ≈ −3: **enterrados** |
| Mundo terminando | panorâmica | névoa 100% além de ~200 m apagava relevo e mata; ampliar o terreno não adiantava |
| Fachada em sombra branca (255) | medição de histograma | luz do céu somada **três vezes**: IBL + hemisférica + ambiente |
| Tudo azulado | medição B−R | o PMREM capturava o **disco do sol** e não tinha **chão**: o sol entrava duas vezes e o rebote do solo, nenhuma |
| Fios verticais na fachada | raycast (`matAt`) | `stoneVeinTexture` desenhava veios de cima a baixo com jitter de 50 px |
| Textura esticada | recorte ampliado | `BoxGeometry` gera UV 0..1 por face: parede de 14 m e puxador de 12 cm recebiam o mesmo trecho |
| Grade no gramado distante | panorâmica | moiré de mipmap com 450 repetições em ângulo rasante |
| Grama dentro da piscina | câmera da piscina | o sorteio de tufos era radial e não conhecia o que havia no terreno |
| 1 MB baixado à toa | leitura do arquivo | GLB embutidos decodificados em todo carregamento, mas descartados sem `?models=1` |
| 34 requisições 404 por carga | console do teste | a pasta `assets/` opcional era sondada arquivo a arquivo |
| **Luz de janela iluminando para fora** | varredura medida: subir a intensidade de 3,4 → 400 mudava a panorâmica externa (119,9 → 140,7) e **não mexia** o interior (129,3 → 129,2) | `RectAreaLight` emite no **−Z local**; o `rotation.y = π` virava a emissão para o jardim. A luz de vão envidraçado nunca chegou ao interior — daí os ambientes frios |
| "Noite lendo como fim de tarde" | capítulo "Visão Final" | **falso positivo do harness**: o `shoot.mjs` não aplicava o `light` do capítulo, então toda cena noturna era renderizada com luz de dia |
| Arquitetura sumindo à noite | mesma câmera, já com a luz correta | `glassGlow` em 0,32 virava painel âmbar chapado; preenchimento da parada `night` baixo demais; e o céu de Preetham colapsa para preto com o sol abaixo do horizonte |

## 8. Se for continuar

**Modelagem 3D.** Não há Blender. Há um **SketchUp via MCP**, e ele
funciona: constrói geometria por Python e salva `.skp`. O interpretador
não tem filesystem, mas dá para trazer a geometria de volta pelo `result`
em JSON — testado e funcionando:

```python
def extrair(entities):
    saida = []
    for f in entities.get_faces():
        n = f.get_normal()
        pos = [[v.get_position().x, v.get_position().y, v.get_position().z]
               for v in f.get_outer_loop().get_vertices()]
        for k in range(1, len(pos) - 1):              # leque de triângulos
            saida.append({"v": [pos[0], pos[k], pos[k+1]],
                          "n": [n.x, n.y, n.z]})
    return saida
result = {"tris": extrair(grupo.get_entities())}      # unidades: POLEGADAS
```

Regra ao usar: traga **só a geometria** e aplique os materiais do
projeto. Foi exatamente isso que derrubou a tentativa anterior com
Blender — os GLB chegaram com materiais próprios e destoaram da cena, e
por isso ficaram desligados atrás de `?models=1`. Eles seguem em
`assets/models/*.glb`, prontos para reabrir.

Antes de investir nisso, note o que a auditoria mostrou: este MCP entrega
`GeometryInput`/`LoopInput`, ou seja, você triangulariza à mão de
qualquer jeito. Para peças de revolução ou perfil varrido,
`LatheGeometry` e `ExtrudeGeometry` no próprio projeto dão o mesmo
resultado sem malha importada — foi assim que a espreguiçadeira foi
refeita. SketchUp compensa para formas que realmente exigem construção
manual complexa, não para móveis paramétricos.

**Texturas PBR externas.** `ASSET_MANIFEST.textures` já define os nomes
de arquivo esperados em `assets/textures/`. Basta colocar os arquivos:
`Assets.applyToMaterials(M)` sobrescreve as procedurais sozinho.

**Vegetação.** Para uma espécie nova, adicione um material com
`leafCardTexture()` e chame `emitTree()` apontando para a lista dele. O
custo é uma lista de matrizes a mais, não um draw call a mais.
