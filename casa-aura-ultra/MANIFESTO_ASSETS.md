# Manifesto de assets — Casa Aura

O projeto **roda inteiro sem nenhum destes arquivos**. Toda textura,
material e peça de mobiliário é gerada por código no boot. Esta lista
existe por duas razões: para você saber exatamente o que colocar se
quiser substituir o procedural por assets reais, e para que ninguém
confunda "referenciado" com "faltando".

## Como o código se comporta

Antes de tentar carregar qualquer coisa, a cena **sonda**
`concrete_diff.jpg`. Se não responder, marca os assets como indisponíveis
e segue no caminho procedural — sem erro, sem log de alarme, sem
degradação de qualidade percebida. É o caminho normal de execução hoje.

Em `file://` a sondagem é pulada de propósito: uma requisição de origem
opaca falha de um jeito que não distingue "ausente" de "bloqueado".

## Onde colocar

`public/assets/` com estes nomes, ou outra origem via `?assets=https://…/`.

| arquivo | tipo | presente |
|---|---|---|
| `concrete_diff.jpg` | textura base | não |
| `concrete_nor.jpg` | normal map | não |
| `concrete_rough.jpg` | roughness map | não |
| `wood_dark_diff.jpg` | textura base | não |
| `wood_dark_nor.jpg` | normal map | não |
| `wood_dark_rough.jpg` | roughness map | não |
| `wood_deck_diff.jpg` | textura base | não |
| `wood_deck_nor.jpg` | normal map | não |
| `wood_deck_rough.jpg` | roughness map | não |
| `wood_light_diff.jpg` | textura base | não |
| `wood_light_nor.jpg` | normal map | não |
| `wood_light_rough.jpg` | roughness map | não |
| `travertine_diff.jpg` | textura base | não |
| `travertine_nor.jpg` | normal map | não |
| `travertine_rough.jpg` | roughness map | não |
| `marble_diff.jpg` | textura base | não |
| `marble_nor.jpg` | normal map | não |
| `marble_rough.jpg` | roughness map | não |
| `stucco_diff.jpg` | textura base | não |
| `stucco_nor.jpg` | normal map | não |
| `stucco_rough.jpg` | roughness map | não |
| `grass_diff.jpg` | textura base | não |
| `grass_nor.jpg` | normal map | não |
| `pavers_diff.jpg` | textura base | não |
| `pavers_nor.jpg` | normal map | não |
| `pavers_rough.jpg` | roughness map | não |
| `sofa.glb` | modelo GLB -> createSofa | não |
| `armchair.glb` | modelo GLB -> createArmchair | não |
| `dining_set.glb` | modelo GLB -> createDiningSet | não |
| `bed.glb` | modelo GLB -> createBed | não |
| `lounger.glb` | modelo GLB -> createOutdoorLounger | não |
| `plant.glb` | modelo GLB -> createPottedPlant | não |
| `tree.glb` | modelo GLB -> tree | não |
| `ambient_garden.mp3` | audio | não |
| `water_loop.mp3` | audio | não |

## Modelos embutidos

Existe também `./assets/models/embedded-models.js`, um payload opcional
com os GLB em base64. Ele **só é buscado com `?models=1`** e, se não
existir, a promessa resolve `null` e a cena usa o mobiliário procedural.
Isso foi tirado do caminho crítico numa rodada anterior: eram 1 MB
baixados por todo cliente e descartados em seguida.

## Fontes

`Fraunces` e `Inter`, do Google Fonts, por `<link>` no HTML. Sem rede as
fontes caem para a pilha do sistema e **o layout não quebra** — foi
verificado no cenário de rede bloqueada da matriz de boot.
