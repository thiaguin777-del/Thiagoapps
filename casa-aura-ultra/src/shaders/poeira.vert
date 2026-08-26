uniform float casaAura_tempo;
uniform float casaAura_tamanho;
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
  gl_PointSize = casaAura_tamanho * (30.0 / -mv.z);
  gl_Position = projectionMatrix * mv;

  // Some com a distancia, para nao virar neve no horizonte.
  casaAura_alpha = smoothstep(60.0, 6.0, -mv.z);
}
