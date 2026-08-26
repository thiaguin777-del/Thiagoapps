uniform vec3 casaAura_cor;
uniform float casaAura_intensidade;
uniform vec3 casaAura_meia;        // meias dimensões do prisma, local
uniform vec3 casaAura_direcaoSol;  // direção do feixe, em mundo
uniform float casaAura_tempo;
varying vec3 casaAura_local;
varying vec3 casaAura_paraCamera;

void main() {
  // 1. Queda ao longo do feixe: a luz se dispersa conforme avança.
  //    O eixo Z local é o comprimento (a geometria é construída assim).
  float ao_longo = (casaAura_local.z + casaAura_meia.z) / (2.0 * casaAura_meia.z);
  float queda = 1.0 - ao_longo;
  queda *= queda;

  // 2. Bordas macias na seção. Um prisma de arestas duras lê como
  //    caixa de vidro, não como ar iluminado.
  vec2 s = abs(casaAura_local.xy) / casaAura_meia.xy;
  float secao = (1.0 - smoothstep(0.55, 1.0, s.x))
              * (1.0 - smoothstep(0.55, 1.0, s.y));

  // 3. Anisotropia: um facho no ar é MUITO mais brilhante visto contra
  //    a direção de propagação. Sem isto ele tem o mesmo brilho de
  //    qualquer ângulo e vira um objeto sólido.
  float frente = clamp(dot(casaAura_paraCamera, casaAura_direcaoSol), 0.0, 1.0);
  float aniso = 0.25 + 0.75 * pow(frente, 2.5);

  // 4. Poeira em suspensão dentro do facho: variação lenta e sutil que
  //    impede o feixe de ser uma chapa de cor uniforme.
  float gr = sin(casaAura_local.x * 3.1 + casaAura_tempo * 0.35)
           * sin(casaAura_local.y * 2.7 - casaAura_tempo * 0.27);
  float grao = 0.88 + gr * 0.12;

  float a = queda * secao * aniso * grao * casaAura_intensidade;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(casaAura_cor * a, a);
}
