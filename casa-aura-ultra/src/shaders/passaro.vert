uniform float casaAura_tempo;
attribute float casaAura_lado;
void main() {
  vec3 p = position;
  // A batida vem de um deslocamento vertical na PONTA da asa, com
  // fase por instancia dada pela posicao do objeto — assim o bando
  // nao bate em unissono, que e o que denuncia efeito automatico.
  float bat = sin(casaAura_tempo * 7.0 + modelMatrix[3].x * 1.7) * 0.34;
  p.y += abs(casaAura_lado) * bat;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
