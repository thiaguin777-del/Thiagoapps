uniform float casaAura_tempo;
uniform float casaAura_altura;
attribute vec2 casaAura_semente;   // x: fase, y: escala
varying float casaAura_vida;

void main() {
  float fase = casaAura_semente.x;
  // Cada particula percorre 0..1 e reinicia. O fract garante o ciclo sem
  // nenhum estado do lado da CPU.
  float vida = fract(casaAura_tempo * 0.14 + fase);
  casaAura_vida = vida;

  vec3 p = position;
  p.y += vida * casaAura_altura;
  // Abre em cone e ondula: fumaca nao sobe reta, e a ondulacao e o que
  // impede o efeito de ler como coluna de particulas.
  float abertura = vida * 0.9;
  p.x += sin(fase * 6.28 + vida * 3.4) * abertura;
  p.z += cos(fase * 5.11 + vida * 2.9) * abertura;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // CALIBRADO OLHANDO O RENDER. Com (10 + vida*46) * (26 / -mv.z) uma
  // particula chegava a ~97 px a 15 m, e 120 delas empilhadas fechavam
  // um disco branco sobre a area gourmet — parecia explosao, nao
  // churrasqueira. Fumaca de verdade e FINA: o que se ve e o volume,
  // nao cada bolota.
  gl_PointSize = (5.0 + vida * 20.0) * casaAura_semente.y * (13.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
