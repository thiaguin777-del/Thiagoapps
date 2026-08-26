varying float casaAura_vida;
uniform vec3 casaAura_cor;
uniform float casaAura_opacidade;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float borda = smoothstep(0.25, 0.0, r);
  // Nasce quase opaca e some no topo. A subida do alpha no comeco evita
  // que a particula "apareca" do nada na boca da churrasqueira.
  float a = smoothstep(0.0, 0.12, casaAura_vida) * (1.0 - casaAura_vida);
  gl_FragColor = vec4(casaAura_cor, borda * a * casaAura_opacidade);
}
