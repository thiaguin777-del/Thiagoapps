uniform vec3 casaAura_cor;
uniform float casaAura_opacidade;
varying float casaAura_alpha;

void main() {
  // Disco suave desenhado na propria coordenada do ponto: sem textura,
  // sem upload, sem gerenciamento de memoria.
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float borda = smoothstep(0.25, 0.02, r);
  gl_FragColor = vec4(casaAura_cor, borda * casaAura_alpha * casaAura_opacidade);
}
