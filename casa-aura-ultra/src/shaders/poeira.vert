uniform float casaAura_tempo;
uniform float casaAura_tamanho;
// Direcao PARA onde o sol aponta (do sol para a cena), normalizada.
uniform vec3 casaAura_sol;
attribute vec3 casaAura_semente;   // x: fase, y: velocidade, z: raio da orbita
varying float casaAura_alpha;

void main() {
  vec3 p = position;
  float fase = casaAura_semente.x;
  float vel  = casaAura_semente.y;
  float raio = casaAura_semente.z;

  // Deriva lenta e circular, mais uma subida quase imperceptivel. Poeira
  // real nao cai: ela fica suspensa e vagueia com a corrente de ar.
  float t = casaAura_tempo * vel + fase * 6.2831;
  p.x += sin(t) * raio;
  p.z += cos(t * 0.83) * raio;
  p.y += sin(t * 0.37) * raio * 0.6;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // Tamanho em perspectiva: perto e maior. Sem isto a poeira longe fica
  // do mesmo tamanho da de perto e o efeito vira chuva de pontos.
  //
  // ACHADO NA CAPTURA DO CAPITULO "Sala de Estar" (que so ficou
  // alcancavel depois do conserto da barra de capitulos): a poeira lia
  // como NEVE CAINDO DENTRO DE CASA -- dezenas de discos brancos moles,
  // alguns com 40 px, por cima do quadro inteiro. Era tambem a origem
  // das "manchas brancas no vidro" vistas de fora.
  //
  // A conta: com tamanho 1,7 o ponto tem 1,7 * 30 / d pixels, ou seja
  // 51 px a 1 m e 25 px a 2 m. Um grao de poeira real tem ~50 um; a 1 m,
  // com 38 graus de campo em 800 px, um pixel vale ~0,86 mm. O disco
  // estava quatro ordens de grandeza acima do fisico.
  //
  // Pior: o alpha era `smoothstep(60, 6, -mv.z)`, que da opacidade MAXIMA
  // no ponto mais proximo. Grande e opaco perto e exatamente a receita da
  // neve. Poeira em raio de sol e o contrario: minuscula, muitas, e some
  // quando esta perto demais da lente para estar em foco.
  float tam = casaAura_tamanho * (30.0 / -mv.z);
  gl_PointSize = clamp(tam, 1.0, 6.0);
  gl_Position = projectionMatrix * mv;

  // Some com a distancia (nao virar neve no horizonte) E MUITO PERTO: a
  // 40 cm da lente a particula estaria fora de foco, sem contraste.
  casaAura_alpha = smoothstep(60.0, 6.0, -mv.z) * smoothstep(0.35, 1.6, -mv.z);

  // ------------------------------------------------------------
  // POEIRA SO APARECE CONTRA A LUZ
  //
  // ACHADO NA CAPTURA DO ESTAR, recapturada pelo caminho do produto:
  // dezenas de pontos brancos por cima de parede, teto e sofa. Lia como
  // sujeira na lente, e num interior fechado isso arruina o quadro.
  //
  // A rodada anterior ja tinha consertado TAMANHO e opacidade, e o
  // blending ja era aditivo. O que faltava era o modelo fisico.
  //
  // Poeira nao brilha: ela ESPALHA. E o espalhamento de Mie e
  // fortemente para a FRENTE -- um grao devolve para o observador
  // dezenas de vezes mais luz quando a fonte esta atras dele do que
  // quando esta atras do observador. Por isso poeira e visivel num raio
  // de sol entrando pela janela e INVISIVEL contra uma parede iluminada:
  // ali ela tem a mesma luminancia do fundo.
  //
  // A conta e um produto escalar: quanto a direcao de visao se alinha
  // com a direcao da luz. Elevado ao cubo para concentrar o lobulo,
  // como o termo de Henyey-Greenstein faz de forma mais cara.
  //
  // O piso de 0,08 e deliberado: nao vai a zero, senao a poeira sumiria
  // por completo em todo quadro que nao olha para o sol, e o ar voltaria
  // a ficar limpo demais -- que era o defeito ANTES de a poeira existir.
  // ------------------------------------------------------------
  vec3 pMundo = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 paraCamera = normalize(cameraPosition - pMundo);
  float contraLuz = max(0.0, dot(paraCamera, -casaAura_sol));
  casaAura_alpha *= 0.08 + 0.92 * pow(contraLuz, 3.0);
}
