# Configuração de produção — Casa Aura

Tudo que precisa ser decidido ou preenchido antes de mandar o link para
um cliente. Cada item diz **onde mexer**, **como verificar** e **como
voltar atrás**.

---

## 1. Contato de WhatsApp

O produto tem quatro CTAs de contato: o botão do herói, três botões de
plano no painel comercial, e o botão da tela de fallback. **Todos leem o
mesmo número**, de `src/core/Contato.ts`.

### Ordem de precedência

| # | origem | como usar | quando serve |
|---|---|---|---|
| 1 | `?wa=` na URL | `https://seusite/?wa=5561993666859` | mandar um link com número diferente sem republicar |
| 2 | `window.CASA_AURA_WHATSAPP` | injetado no HTML pelo deploy | um número por ambiente |
| 3 | `CONFIG.whatsappThiago` | `src/legado/cena-bruta.ts`, topo | o padrão que vai no build |

Hoje o padrão no código é **`5561993666859`**.

### O 55 não é opcional

`wa.me` lê os primeiros dígitos como **código de país**. `61993666859`
sem o `55` é interpretado como **Austrália**, e o link vai para o lugar
errado — sem erro nenhum na tela. O código normaliza: um número com 10
ou 11 dígitos começando por DDD válido (11–99) recebe `55` automaticamente
e registra um aviso no console. Para outro país, **inclua o código**.

### Sem número configurado

Não é falha silenciosa: o botão do herói some, os três botões de plano
ficam **desabilitados com o texto "Contato não configurado"** e
`aria-disabled="true"`, e o botão do fallback é removido. Verificado nos
cinco casos de configuração.

### Como verificar

Abra o console e procure `[contato]`. Ou clique um CTA de plano: o link
tem de abrir `wa.me/55…` com a mensagem já escrita, dizendo qual plano.

### Rollback

Trocar o número em `CONFIG.whatsappThiago` e republicar. Ou, sem
republicar, mandar o link com `?wa=` — ele tem precedência sobre tudo.

---

## 2. Hospedagem

`netlify.toml` na raiz do repositório já traz:

- `base = "casa-aura-ultra"`, `publish = "dist"`, `command = "npm ci && npm run build"`
- o build roda `tsc --noEmit` antes do `vite build`: **erro de tipo reprova o deploy** em vez de publicar artefato quebrado
- `/assets/*` com cache imutável de um ano (os nomes carregam hash de conteúdo)
- `index.html` e `sw.js` com `no-cache` — a casa muda, e servir versão velha do imóvel é a pior falha possível aqui
- cabeçalhos de segurança: `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`

### Publicar

O site **`casa-aura-demo-tecnica`** já foi criado na conta
(`thiagoudf777@gmail.com`), id `b5fcf026-b43c-4038-963e-97f4ab928f2f`,
URL `https://casa-aura-demo-tecnica.netlify.app`.

O deploy **não pôde ser executado desta sessão**: a política de rede do
ambiente bloqueia `api.netlify.com` (403 no CONNECT do proxy). Duas
saídas, ambas de um passo:

1. **Pelo Git (recomendado).** No painel do Netlify, em
   *Project configuration → Build & deploy → Link repository*, escolher
   `thiaguin777-del/Thiagoapps` e a branch de trabalho. O `netlify.toml`
   já diz o resto. Toda publicação futura passa a ser um `git push`.

2. **Pela CLI, da sua máquina**, dentro do repositório:
   ```
   npx netlify-cli deploy --prod --site b5fcf026-b43c-4038-963e-97f4ab928f2f
   ```

### Acesso

A conta está com **SSO de time exigido em todos os projetos**. Isso deixa
o site privado — bom para rascunho, mas **o celular vai pedir login**.
Para abrir a um cliente: *Project configuration → Access control*, trocar
para público ou para senha.

---

## 3. Assets opcionais

O projeto roda **sem nenhum asset externo** — toda textura, material e
mobiliário é procedural. É por isso que o pacote tem 274 KB de fonte.

Há um manifesto de 30 arquivos **referenciados e ausentes** (21 texturas,
7 modelos `.glb`, 2 áudios). O código sonda a presença e cai no
procedural quando faltam; **não é erro**, é o caminho normal. Ver
`MANIFESTO_ASSETS.md`.

Para usar assets reais: colocá-los em `public/assets/` com os nomes do
manifesto, ou apontar outra origem com `?assets=https://.../`.

### Rollback

Remover a pasta. A cena volta ao procedural sozinha.

---

## 4. Telemetria

**Desligada por padrão, e é deliberado:** nada é enviado a terceiro
enquanto `TELEMETRIA.url` e `TELEMETRIA.chave` não forem preenchidos em
`src/legado/cena-bruta.ts`. Sem isso a função devolve na primeira linha.

O que é enviado quando ligada: tier, tempo de quadro (média, p50, p95,
p99, pior, contagem de engasgos), draw calls, número de programas, tempo
até pronto, user-agent, memória, núcleos, DPR, resolução e suporte a
WebGL 2. **Nenhum dado pessoal, nenhum identificador de cliente** — a
sessão é um UUID gerado na hora.

### Como ligar

Preencher `url` e `chave`. Antes disso, avaliar a base legal do envio.

---

## 5. Eventos de conversão

`src/core/Analytics.ts` registra: herói, apresentação, capítulo, hotspot,
plano selecionado, CTA, fallback e modo leve. Os eventos ficam em memória
e vão junto da telemetria — **não há pixel de terceiro**.

---

## 6. Escopo comercial

Os três planos e os preços estão no markup de `index.html`, bloco
`.plans`. **Eles precisam da sua aprovação** antes de qualquer
publicação: o que está lá veio de rodada anterior e não foi confirmado
nesta.

O aviso de que **Casa Aura é projeto conceitual** está em
`index.html`, classe `.disclaimer`, e deve permanecer até haver
autorização e dados de um imóvel real.

---

## Parâmetros de URL

Levantados do código-fonte, não de memória — `grep -rn "location.search" src/`.

| parâmetro | valores | para que serve |
|---|---|---|
| `?wa=` | número com código do país | trocar o WhatsApp do CTA sem republicar. Tem precedência sobre tudo. |
| `?debug=1` | — | painel de diagnóstico: tier, motivo da última troca, FPS e tempo de quadro em p50/p95/p99, draws, triângulos, programas, DPR, renderer. É o instrumento da `MATRIZ_DISPOSITIVOS.md`. |
| `?q=` | `ultra`, `high`, `medium`, `low` | trava o preset de qualidade e **desliga o rebaixamento automático**. Serve para auditar um tier específico e para o corretor forçar `ultra` num notebook bom. |
| `?tier=` | `REALTIME`, `COMPATIBILITY`, `PRESENTATION_SAFE` | trava o tier de proteção de apresentação. Igual ao `?q=`, desliga as decisões do governador — mas **não** as medições, para o `?debug=1` continuar honesto. |
| `?validar=1` | — | roda a autoverificação de arranque e imprime o resultado no console. |
| `?assets=` | caminho ou URL | muda a base dos assets externos. Usado para servir a pasta `assets/` de um CDN. |
| `?models=1` | — | tenta carregar os GLB externos em vez da geometria procedural. Sem os arquivos, cai na procedural. |
| `?semente=` | número | fixa a semente da vegetação procedural, para duas capturas ficarem comparáveis. |
| `?poeira=1` | — | liga a poeira suspensa, **desligada por padrão**. Ver a análise em `CasaAuraScene.montarParticulas`: com blending aditivo não existe opacidade que apareça na sombra e suma na luz. |

Os três primeiros são os que interessam a quem vende. Os demais são de
diagnóstico e não precisam aparecer para o cliente.
