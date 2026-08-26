// ============================================================
// CÁUSTICAS — a malha de luz no fundo da piscina
// ------------------------------------------------------------
// Três iterações de um campo que se dobra sobre si mesmo. O `pow` no fim
// é o que transforma um borrão suave nos filamentos brilhantes que a água
// faz de verdade — sem ele o efeito parece névoa, não luz focada.
//
// O DOMÍNIO DE ENTRADA NÃO É OPCIONAL, e foi por não perceber isso que a
// primeira versão não fez absolutamente nada. O termo interno é
// `p / (sin(...) / 0.005)`, ou seja `p` dividido por algo de módulo até
// 200. Com `p` pequeno (as coordenadas da piscina em metros, ±2,8) a
// divisão dá quase zero, `1/length` explode e `c` satura: a função
// devolvia 1,0 em CADA ponto do casco. Não era uma cáustica fraca — era
// uma constante, e por isso o A/B não acusava diferença nenhuma.
//
// `casaAura_dominio` é a correção: dobra as coordenadas em [0, TAU) e as
// desloca para perto de -250. Aí `p / 200` fica na casa de 1,25,
// `1/length` fica em torno de 0,6, e sai o desenho de rede.
//
// Conferido numericamente antes de voltar ao shader:
//   errado  -> média 1,0000, cobertura 100% (constante)
//   certo   -> média 0,11, pico 0,68, 27% da área acima de 0,15
// ============================================================
vec2 casaAura_dominio(vec2 uv) {
  return mod(uv * 6.28318530718, 6.28318530718) - 250.0;
}
float casaAura_caustica(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  const float intensidade = 0.005;
  for (int n = 0; n < 3; n++) {
    float ft = t * (1.0 - (3.0 / float(n + 1)));
    i = p + vec2(cos(ft - i.x) + sin(ft + i.y),
                 sin(ft - i.y) + cos(ft + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + ft) / intensidade),
                           p.y / (cos(i.y + ft) / intensidade)));
  }
  c /= 3.0;
  c = 1.17 - pow(c, 1.4);
  // Expoente 6: com 8 o filamento cobre 11% do fundo e some sob a
  // lâmina de 45% de opacidade; com 4 cobre 57% e vira um brilho geral.
  // 6 dá 27% de cobertura, que é desenho de rede.
  return clamp(pow(abs(c), 6.0), 0.0, 1.0);
}
