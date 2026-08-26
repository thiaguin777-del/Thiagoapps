varying vec3 casaAura_local;
varying vec3 casaAura_paraCamera;

void main() {
  casaAura_local = position;
  vec4 mundo = modelMatrix * vec4(position, 1.0);
  casaAura_paraCamera = normalize(cameraPosition - mundo.xyz);
  gl_Position = projectionMatrix * viewMatrix * mundo;
}
