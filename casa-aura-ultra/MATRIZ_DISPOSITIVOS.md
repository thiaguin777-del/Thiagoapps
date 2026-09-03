# Matriz de dispositivos — a preencher com aparelho real

Esta tabela está **vazia de propósito**. Nenhum número aqui pode sair
deste repositório: o ambiente onde o projeto foi construído **não tem
GPU** (renderiza por software, ~0,1 quadro por segundo), então qualquer
FPS que eu escrevesse seria invenção.

O código já traz o instrumento. Você só precisa abrir e ler.

---

## Como medir (2 minutos por aparelho)

1. Abra o link com **`?debug=1`** no fim da URL.
2. Deixe a cena carregar por completo.
3. **Explore por 60 segundos** — gire, aproxime, entre num ambiente. Não
   deixe parada: o que interessa é o tempo de quadro em movimento.
4. Abra o console do navegador. A cada segundo sai uma linha assim:

```
[perf] 58 fps | quadro 17.2 ms | p50 16.8 p95 21.4 p99 33.1 pior 48.0 engasgos 3 | 214 draw | 99 programas
```

5. Copie a linha depois dos 60 s e preencha a tabela.

### O que cada número significa

| campo | o que é | quando preocupa |
|---|---|---|
| `p50` | metade dos quadros são mais rápidos que isso | acima de 20 ms |
| `p95` | os 5% piores começam aqui | acima de 33 ms |
| `p99` | o 1% pior | acima de 50 ms |
| `pior` | o quadro mais lento da janela | acima de 100 ms |
| `engasgos` | quadros acima do dobro da mediana | crescendo sem parar |

**Média de FPS não é a métrica.** Uma sessão a 60 fps médio com um quadro
de 90 ms a cada dois segundos *parece travada*, e a média não muda. É por
isso que a tabela pede percentis.

---

## Aparelhos a cobrir

| # | aparelho | navegador | tier | p50 | p95 | p99 | pior | engasgos | boot até pronto | veredito |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | notebook do corretor | Chrome | | | | | | | | |
| 2 | iPhone (o seu) | Safari | | | | | | | | |
| 3 | Android médio | Chrome | | | | | | | | |
| 4 | iPad | Safari | | | | | | | | |
| 5 | notebook antigo / integrada | Chrome | | | | | | | | |
| 6 | Android fraco | Chrome | | | | | | | | |

**Tier** aparece em `document.body.dataset.quality`: `ultra`, `high`,
`medium` ou `low`. Sai também no painel de debug.

---

## Checagens que não são de desempenho

Marque em cada aparelho:

| verificação | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Carrega até o herói | | | | | | |
| Apresentação roda inteira, sem plano de costas para a casa | | | | | | |
| Toque: girar, aproximar, dois dedos | | | | | | |
| Botões alcançáveis com o polegar | | | | | | |
| Textos legíveis sem aproximar | | | | | | |
| Esc / botão de sair funcionam em todo modo | | | | | | |
| CTA de WhatsApp abre com a mensagem certa | | | | | | |
| Girar a tela (retrato ↔ paisagem) não quebra | | | | | | |
| Voltar de outra aba retoma a cena | | | | | | |
| Sem rede: fontes caem para a do sistema, layout inteiro | | | | | | |

---

## O que fazer com um aparelho que reprova

Não mexa em código por causa de um número ruim antes de saber a causa.
A ordem de investigação, do mais provável ao menos:

1. **Boot travado** — `?debug=1` mostra em que etapa parou.
2. **Engasgo de compilação de shader** — engasgos altos nos primeiros
   segundos e depois estáveis. O pré-aquecimento já trata; se persistir,
   o orçamento de 6 s pode estar curto para o aparelho.
3. **Resolução alta demais** — `pixelRatio` no painel. É o degrau mais
   barato.
4. **Passes de pós-processamento** — bloom e GTAO custam por pixel.
5. **Sombras** — `shadowMap` por tier.
6. **Vidro com transmissão** — caro, e só no tier alto.
7. **Partículas e vegetação** — os últimos a cortar; são o que dá vida.
