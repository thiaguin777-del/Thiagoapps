# Casa Aura — operação de produção

## Posicionamento

Casa Aura é uma experiência imobiliária 3D interativa para apresentação de imóveis, lançamentos e portfólios de corretores. Esta entrega foi preparada para demonstração comercial controlada; desempenho absoluto em qualquer aparelho não pode ser garantido sem uma matriz de dispositivos reais.

## Configuração de contato

O número do WhatsApp nunca deve ser colocado como placeholder no código. Para um build de produção, configure a variável `VITE_CASA_AURA_WHATSAPP` com o número em formato internacional, apenas dígitos, por exemplo `5511999999999`.

Para demonstração rápida sem rebuild, o link também aceita `?wa=5511999999999`. Se nenhum número válido estiver presente, o CTA é ocultado ou permanece inerte de forma explícita; a experiência não inventa contato e não abre uma URL inválida.

## Comandos

```bash
npm ci
npm run typecheck
npm run build
npm run build:unico
```

O build normal cria a aplicação em `dist/`. O build único gera `casa-aura.html`, adequado para compartilhamento como arquivo. Para uso profissional, prefira o build hospedado em HTTPS, porque service worker, cache, fontes e compartilhamento social funcionam melhor em uma origem web.

## Checklist antes de enviar a um corretor

1. Abra a página em desktop e celular.
2. Confirme que o hero aparece e que o botão Explorar inicia a cena.
3. Execute o Modo Cinemático completo.
4. Troque Dia, Golden, Blue Hour e Noite.
5. Abra pelo menos três capítulos e um hotspot.
6. Teste Modo Corte e retorne à exploração.
7. Abra o painel comercial.
8. Teste o CTA geral e um CTA de cada plano.
9. Confirme que a mensagem chega ao WhatsApp correto.
10. Teste `Escape`, teclado, rotação de tela e retorno da aba em segundo plano.
11. Abra com rede limitada e confirme que o fallback de assets não trava o boot.
12. Registre aparelho, navegador, tempo de carregamento e qualquer engasgo.

## Critérios de aceite

A entrega pode ser chamada de pronta para venda controlada quando o build e o typecheck passam, o boot termina em cena ou fallback sem loading infinito, as transições principais não deixam a FSM presa, os CTAs possuem destino real, e a demonstração foi executada no aparelho que será usado pelo corretor.

A entrega não deve ser descrita como “sem bugs em qualquer aparelho” ou “60 FPS garantidos” antes de medir hardware real. O controlador adaptativo existe para degradar a qualidade progressivamente, mas não substitui teste de campo.

## Publicação

O workflow `.github/workflows/deploy-casa-aura.yml` gera o HTML único e publica o resultado no GitHub Pages. No repositório, ative Pages com a origem `GitHub Actions`. Configure a variável de repositório `CASA_AURA_WHATSAPP` antes da publicação. Se a variável não for configurada, a página continuará demonstrável, mas sem CTA de WhatsApp ativo.
