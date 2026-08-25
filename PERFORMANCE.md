# Casa Aura — desempenho e imagem, antes e depois

Sessão de otimização sobre o branch `claude/performance-realismo-v3`.

## O aviso que vem primeiro

**Nada aqui mede FPS ou tempo de GPU de verdade.** O ambiente de
desenvolvimento não tem GPU: renderiza por SwiftShader, em software, numa
máquina compartilhada. Um número de quadro medido aqui não diz nada sobre o
iPad do corretor.

O que dá para medir aqui, e está medido: draw calls, programas compilados,
contagem de materiais, geometrias e texturas, custo de CPU do boot, e a
imagem em si (luminância por faixa, canal por canal, recorte).

O que **não** dá, e não foi feito: confirmar 60fps. Para isso existe agora
telemetria pronta no cliente (`TELEMETRIA`, inerte até ser configurada) e o
painel de debug com fps, tempo de quadro, draw calls e programas. A
confirmação tem de vir dos aparelhos reais.

Uma promessa de "60fps em qualquer hardware" não se valida sem os
aparelhos. Qualquer número de fps neste documento seria inventado.

---

## Tabela

| Métrica | Antes | Depois | Delta |
|---|---|---|---|
| Draw calls (ultra) | 477 | **297** | −38% |
| Draw calls (high) | 477 | 297 | −38% |
| Draw calls (medium) | 515 | 363 | −30% |
| Draw calls (low) | 511 | 361 | −29% |
| Programas (ultra) | 93 | 84 | −10% |
| Materiais distintos na cena | 136 | 110 | −19% |
| Geometrias | 237 | 151 | −36% |
| Meshes opacos estáticos | 170 | 107 | −37% |
| Meshes que ainda poderiam fundir | 95 | 32 | −66% |
| RectAreaLight em medium/low | 2 | **0** | LTC fora do aparelho fraco |
| Recorte do vermelho (bancada, golden) | **66,8%** | **0%** | tone mapping |
| B−R do interior (golden) | −135,3 | −91,4 | |
| B−R do interior (day) | −24,5 | −24,5 | já estava bom |
| Requisições externas obrigatórias | **1 (unpkg)** | **0** | |
| Tamanho do entregável | 320 KB + CDN | 1103 KB (442 KB gzip), autocontido | |
| Espera pelo payload opcional | até 10 s | até 2 s | caminho crítico |
| Reação a queda de fps | 24fps × 3 s | 45fps × 2 s | |

Tempo de carregamento em WiFi e 4G **não está medido** — depende da rede e
do servidor, e este ambiente não tem nem um nem outro representativos. O
que dá para dizer: o arquivo tem 442 KB comprimido e zero requisições
externas obrigatórias, contra 320 KB mais uma ida ao unpkg que podia nunca
voltar.

---

## O achado que vale mais que todos os draw calls

**O tone mapping ACES nunca chegava à tela quando o composer estava ativo.**

Medido, nesta ordem:

```
renderer.toneMapping = ACESFilmicToneMapping        (configurado)
desligar o tone mapping por completo          -> imagem IDÊNTICA
toneMappingExposure de 0,86 para 0,20         -> imagem IDÊNTICA
as mesmas duas trocas com RenderPass na tela  -> FUNCIONAM
```

Idêntico em todos os decimais: 218,9 / 171,9 / 83,6, com 66,8% do canal
vermelho estourado. Com o EffectComposer no caminho, a cena vai para um
render target e o Three.js só aplica tone mapping e conversão de espaço de
cor na saída **para a tela**. O alvo intermediário guarda linear, e nada na
cadeia mapeia de volta.

O que chegava ao monitor era **linear ceifado em 1,0**.

Isso explica, retroativamente:

- a golden hour "saturada" que ficou pendente do relatório anterior — não
  era escolha de cor, era ceifa de canal;
- o realce sem rolloff em toda superfície clara;
- e que as quatro exposições calibradas (0,875 / 0,86 / 0,98 / 1,05) nunca
  fizeram efeito em ultra, high e medium. Só em low, o único tier sem
  composer.

Pior: a sessão anterior inteira respondeu a "parede estourada" **baixando
fonte de luz**. Estava tratando falta de rolloff com menos luz.

Corrigido aplicando exposição e ACES no último ponto linear da cadeia, o
`ColorGradeShader`, antes de lift/contraste/saturação — que passam a operar
em 0..1, como um grade deve operar.

---

## O que o diagnóstico dizia e a medição desmentiu

Vale registrar, porque quatro das sete causas apontadas não eram a causa.

| Diagnóstico | O que a medição mostrou |
|---|---|
| "92 programas porque cada combinação de macro+uplight+wind gera chave única" | Só **11** materiais têm chave própria. Os ~90 programas são variantes de `#define` do próprio Three.js sobre **136 materiais distintos**. Um uber-shader resolveria — reimplementando o PBR do Three.js. Ataquei contando materiais. |
| "geração síncrona de textura bloqueia 500ms–1,5s" | Verdade na ordem de grandeza (1,9 s aqui), mas **uma única textura custava 1005 ms** e era custo de PRIMEIRA CHAMADA, não do desenho: repetindo a mesma geração, 149 ms na primeira e 7–11 ms nas seguintes. Um Web Worker moveria o aquecimento, não o eliminaria. Os `pbrFromHeight`, que eu ia mandar para o worker, somam 394 ms nos oito juntos. |
| "`Quality.downgrade()` só é chamado no boot" | Não é verdade — já estava no laço de render. O errado era o limiar: 24fps por 3 s são nove segundos de experiência ruim antes de qualquer reação. |
| "`applySolarTime` marca `envDirty` mas não vejo o consumo" | O consumo existe. O que faltava era orçamento: durante o arraste do slider ele regerava a cada poucos quadros. |
| "sombras de contato: 1 draw call, usar decal atlas" | Correto no destino (27 → 1), mas o caminho era outro: os 27 materiais eram **clones por `opacity`**, e `opacity` é comprovadamente inerte sob `MultiplyBlending` (`blendFunc(ZERO, SRC_COLOR)`; o RGB é `dst*src.rgb`). Opacidade 0 em todas: imagem idêntica. |

E um quase-acidente: o primeiro teste das sombras de contato deu
"invisíveis" — esconder as 27 não mudava um decimal. Ia apagá-las. O
raycast mostrou que a câmera estava **em cima** delas, com o móvel na
frente. Numa cena só com piso e sombras, elas escurecem o travertino de
254,3 para 200,8. Funcionavam o tempo todo.

---

## O que foi feito, por trilha

### Track 1 — desempenho

- **Fusão global entre grupos.** `mergeStaticByMaterial` rodava dentro de
  cada grupo; `M.estuque` aparecia em três grupos e virava três meshes.
  Passe global sobre `houseGroup`, com a parada em `userData.mergeRoot`
  continuando a proteger o Modo Corte.
- **Sombras de contato 27 → 1 mesh, 27 → 1 material.** Multiplicação é
  comutativa, então a fusão entre elas é exata, não aproximação.
- **PMREM em orçamento de 900 ms**, com a última geração sempre agendada
  para o céu final acertar ao soltar o slider.
- **Sem RectAreaLight em medium/low.** LTC é duas texturas de lookup mais
  avaliação analítica por fragmento, por luz, e cai inteiro no aparelho
  mais fraco. Compensado pelo rebote da máscara de interior, medido: com
  `fill` 3,0 o medium lê teto 125,2 contra 127,5 do high e parede 155,4
  contra 153,5. Móvel e piso ficam ~25% abaixo — é o preço de trocar fonte
  direcional por rebote isotrópico, e está registrado.
- **`alphaTest`** 0,42 → 0,55 em medium e 0,62 em low.
- **Rebaixamento automático** de 24fps×3s para 45fps×2s, com os dois
  primeiros segundos de fora (ali ainda há compilação de shader).
- **`Perf`**: ms por etapa de build, ms e contagem de textura procedural
  com rótulo por gerador, tempo de quadro, pior fps da sessão.

### Track 2 — imagem

- **Tone mapping** (acima).
- **Árvore crescendo dentro da sala**, atravessando o forro. O teste de
  área proibida já existia e já incluía a pegada da casa; arbusto e
  gramínea o chamavam, e **árvore não**. O objeto maior era o único sem
  verificação.
- **Exposições recalibradas** com o ACES finalmente ativo: dia 0,95,
  golden 0,95, blue 1,10, noite 1,18; contraste do grade 1,05 → 1,12.

### Track 3 — dependência externa

- **`build/standalone.mjs`**: embute o three.js no mesmo arquivo via
  esbuild. Recusa o build se sobrar dependência externa em `<script src>`,
  `<link href>`, import ou importmap.
- **Testado com a rede externa bloqueada** por interceptação de rota. Achou
  um bug de verdade na primeira rodada: `String.replace` com string de
  substituição interpreta `$&`, `` $` `` e `$'`, e um bundle minificado de
  1 MB é cheio de `$` — pedaços do HTML eram injetados no meio do
  JavaScript, o navegador dizia `Unexpected token '<'` e o loader ficava em
  0%.

### Track 5 — bugs

- `optimizeShadowCasters` idempotente (só sabia desligar; subir o tier
  nunca devolvia sombra).
- Timeout do payload embutido: 10 s → 2 s, no caminho crítico.
- `Perf.bootMs` era lido pela telemetria e nunca escrito.

---

## O que NÃO foi feito

Sem rodeio, com o motivo:

| Item | Por quê |
|---|---|
| Uber-shader (meta ≤12 programas) | A causa medida não são os hooks (11 materiais), são as variantes de `#define` sobre 136 materiais. Um uber-shader de verdade significa reimplementar o PBR do Three.js — IBL, sombras, tone mapping, gerenciamento de cor. É semanas de trabalho com regressão visual garantida no meio. O caminho barato é continuar reduzindo materiais distintos. |
| Draw calls ≤120 no ultra | Chegou a 297. O que sobra são 32 meshes que diferem em flag de sombra (entra na chave de propósito) e ~150 objetos com material próprio. Passar disso exige `BatchedMesh` e instancing de props, que não couberam. |
| Web Worker de textura | A medição mostrou que o 1 s é aquecimento de primeira chamada, não trabalho por textura. O worker moveria o custo. |
| PMREM pré-gerado em build | Fiz o orçamento de 900 ms, que resolve o engasgo. Pré-gerar exige pipeline de `.env` e crossfade entre dois environments. |
| LOD/impostor de vegetação | Só o `alphaTest` por tier entrou. |
| `BatchedMesh`, BVH, SSR, TAA | Não alcançados. |
| KTX2/Basis, migração Vite | O build autocontido resolve o risco de negócio (zero requisição externa) preservando o arquivo único, que é o que faz o produto circular por WhatsApp. Um `/dist` de vários arquivos destruiria isso. |
| Supabase aplicado | A conta tem organização e **zero projetos**; criar projeto é ação cobrável. O esquema está pronto em `supabase/migrations/0001_casa_aura.sql` e o cliente de telemetria está no HTML, inerte até `TELEMETRIA.url` ser preenchido. |
| Convenção SketchUp, UX Pilot/VIZBL | Não alcançados. |
| GIF/MP4 de 60fps com stats | Impossível aqui: sem GPU, não há 60fps para filmar. Seria encenação. |
| Banda branca do horizonte, morros com displacement, árvores de primeiro plano | Não alcançados. |

---

## Como medir no aparelho real

1. Abrir `dist/CasaAura.html?debug=1` no iPad ou no celular.
2. O painel mostra fps, tempo de quadro, draw calls, programas, tier e dpr.
3. Com `?q=ultra` o tier trava, para auditar sem o rebaixamento automático
   interferir.
4. Para telemetria agregada: criar o projeto Supabase, aplicar a migração,
   preencher `TELEMETRIA.url` e `TELEMETRIA.chave` (a *publishable*, nunca
   a service key) e reconstruir.
