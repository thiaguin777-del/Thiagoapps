// ============================================================
// ÁGUA — cáusticas, espuma de borda e ondulação de duas camadas
// ------------------------------------------------------------
// Isto NÃO substitui o material da piscina. O material físico da lâmina
// já foi calibrado renderizando a câmera do capítulo "Piscina" várias
// vezes: opacidade 0,45 para o fundo aparecer, envMapIntensity 0,22 para
// o ângulo rasante não virar espelho de céu, sem `transmission` porque
// ela forçava um passe extra da cena inteira. Jogar isso fora para
// escrever um ShaderMaterial do zero perderia todo esse ajuste e ainda
// teria de reimplementar Fresnel, sombra e névoa à mão.
//
// O que falta na lâmina atual, e é o que este módulo acrescenta por
// injeção de shader:
//
//   CÁUSTICAS  A malha de luz no fundo. É o efeito mais reconhecível de
//              uma piscina e ele NÃO vai na superfície: vai no
//              REVESTIMENTO, que é onde a luz refratada de fato bate.
//              Sem isto o fundo é uma superfície azul lisa.
//   ESPUMA     Faixa clara onde a lâmina encontra a parede do casco.
//              Água real molha a borda; um corte reto e limpo entre azul
//              e pedra é a assinatura de água de videogame.
//   ONDULAÇÃO  O normal map original desliza inteiro numa direção só —
//              lido de perto, é uma folha de plástico escorregando. Duas
//              camadas em direções e escalas diferentes se interferem e
//              nunca fecham ciclo visível.
//
// REFRAÇÃO DE VERDADE (deslocar o que se vê através da lâmina) exigiria
// amostrar um alvo de render com a cena já desenhada — ou seja, o passe
// extra que foi deliberadamente removido. Não está aqui, e o motivo é
// esse. A leitura de profundidade que ela daria é entregue mais barato
// pela cáustica, que é o que o olho realmente procura.
// ============================================================
import * as THREE from 'three';
import GLSL_CAUSTICA from '../shaders/caustica.glsl?raw';

export interface AlvosAgua {
  /** Material da lâmina d'água (MeshPhysicalMaterial da cena). */
  materialAgua: THREE.Material | null;
  /** Material do revestimento do casco — onde as cáusticas caem. */
  materialRevestimento: THREE.Material | null;
  /** Centro da piscina em coordenadas de mundo. */
  centro: THREE.Vector3;
  largura: number;
  profundidade: number;
  /** Cota da lâmina, para as cáusticas enfraquecerem com a profundidade. */
  nivel: number;
}

// A função de cáustica vive em `src/shaders/caustica.glsl`, junto com a
// explicação do domínio de entrada — que é o detalhe que faz ela
// funcionar ou devolver uma constante.

export class WaterShader {
  private uTempo = { value: 0 };
  /** Segue o sol: sem sol não há cáustica. Ajustado por `sol`. */
  private uSol = { value: 1.0 };
  private uNivel = { value: 0.02 };
  private uCentro = { value: new THREE.Vector3() };
  private uMeia = { value: new THREE.Vector2(5.1, 2.5) };
  private ligado = false;

  /**
   * Injeta os shaders nos dois materiais. Idempotente: chamar duas vezes
   * não empilha injeção.
   */
  aplicar(alvos: AlvosAgua): void {
    if (this.ligado) return;
    this.uNivel.value = alvos.nivel;
    this.uCentro.value.copy(alvos.centro);
    this.uMeia.value.set(alvos.largura / 2, alvos.profundidade / 2);
    this.injetarRevestimento(alvos.materialRevestimento);
    this.injetarLamina(alvos.materialAgua);
    this.ligado = true;
  }

  /**
   * Cáusticas no casco. Vão como EMISSIVO, não multiplicando a cor
   * difusa: cáustica é luz somada ao que já está lá, e o revestimento no
   * escuro deve continuar escuro entre os filamentos.
   */
  private injetarRevestimento(mat: THREE.Material | null): void {
    if (!mat) return;
    mat.onBeforeCompile = (shader) => {
      // Guarda o shader compilado. Sem isto não há como responder, num
      // aparelho real, à pergunta "a injeção entrou?" — e foi exatamente
      // essa pergunta que travou a calibragem das cáusticas.
      mat.userData.auraShader = shader;
      shader.uniforms.casaAura_tempo = this.uTempo;
      shader.uniforms.casaAura_sol = this.uSol;
      shader.uniforms.casaAura_nivel = this.uNivel;
      shader.uniforms.casaAura_centro = this.uCentro;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 casaAura_pm;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\n  casaAura_pm = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 casaAura_pm;
           uniform float casaAura_tempo;
           uniform float casaAura_sol;
           uniform float casaAura_nivel;
           uniform vec3 casaAura_centro;
           ${GLSL_CAUSTICA}`,
        )
        // Depois do emissivo do material: soma, não substitui.
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           {
             // ESCALA, SEGUNDA CALIBRAGEM, olhando o render com o ganho
             // forçado a 40 para enxergar o padrão. Com 1,4 o casco
             // recebia ~14 dobras em 10,2 m e, como a função ainda tem
             // estrutura fina DENTRO de cada dobra, o resultado era um
             // chuvisco de pontos de poucos pixels — que além de não ler
             // como cáustica ainda cintila quando a câmera anda.
             // 0,35 dá ~3,6 dobras no mesmo trecho: malha larga, com
             // filamento da largura de uma mão no fundo.
             vec2 pc = casaAura_dominio((casaAura_pm.xz - casaAura_centro.xz) * 0.35);
             float c = casaAura_caustica(pc, casaAura_tempo * 0.55);
             // Enfraquece com a profundidade: a luz se espalha ao descer.
             // Só que 0,35 no fundo era queda demais para 1,5 m de lâmina
             // — água de piscina é clara e a malha chega ao fundo forte.
             float prof = clamp((casaAura_nivel - casaAura_pm.y) / 1.6, 0.0, 1.0);
             float atenua = mix(1.0, 0.7, prof);
             // Nas paredes verticais do casco a cáustica também aparece,
             // mais fraca e esticada — por isso não há máscara de normal
             // aqui: cortar a parede deixaria uma linha dura na quina.
             // GANHO 5,0. Com 1,6 a malha existia no shader e não chegava ao
             // olho: forçando o uniform a 40 (25x o máximo do produto) o
             // padrão aparecia inteiro, o que provou que o termo chega à
             // tela e que o problema era só de amplitude.
             totalEmissiveRadiance += vec3(0.55, 0.95, 1.0) * c * casaAura_sol * atenua * 5.0;
           }`,
        );
    };
    mat.customProgramCacheKey = () => 'casaAura_caustica';
    mat.needsUpdate = true;
  }

  /**
   * Superfície: segunda camada de ondulação e espuma de borda.
   */
  private injetarLamina(mat: THREE.Material | null): void {
    if (!mat) return;
    mat.onBeforeCompile = (shader) => {
      mat.userData.auraShader = shader;
      shader.uniforms.casaAura_tempo = this.uTempo;
      shader.uniforms.casaAura_centro = this.uCentro;
      shader.uniforms.casaAura_meia = this.uMeia;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 casaAura_pm;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\n  casaAura_pm = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 casaAura_pm;
           uniform float casaAura_tempo;
           uniform vec3 casaAura_centro;
           uniform vec2 casaAura_meia;`,
        )
        // Segunda camada de normal: a mesma textura, em outra escala e
        // correndo na direção oposta. Duas ondas cruzadas nunca voltam ao
        // mesmo ponto no tempo que o observador consegue perceber.
        //
        // `vNormalMapUv`, NÃO `vUv`. Desde o r152 o Three.js dá a cada
        // mapa a sua própria varying de UV (vMapUv, vNormalMapUv,
        // vRoughnessMapUv...) e `vUv` só existe em material que não usa
        // nenhum desses. Escrever `vUv` aqui compila em qualquer exemplo
        // antigo da internet e falha nesta versão — foi exatamente o erro
        // que apareceu na primeira verificação em navegador.
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           #ifdef USE_NORMALMAP
           {
             vec2 uv2 = vNormalMapUv * 2.7 + vec2(-casaAura_tempo * 0.019, casaAura_tempo * 0.011);
             vec3 n2 = texture2D(normalMap, uv2).xyz * 2.0 - 1.0;
             n2.xy *= normalScale * 0.7;
             normal = normalize(normal + n2 * 0.5);
           }
           #endif`,
        )
        // Espuma: faixa clara onde a lâmina encosta na parede do casco.
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
           {
             vec2 d = abs(casaAura_pm.xz - casaAura_centro.xz);
             // Distância até a borda mais próxima, em metros.
             vec2 ate = casaAura_meia - d;
             float borda = min(ate.x, ate.y);
             // Ruído barato para a faixa não ser um contorno geométrico.
             float ruido = sin(casaAura_pm.x * 9.0 + casaAura_tempo * 1.7)
                         * sin(casaAura_pm.z * 11.0 - casaAura_tempo * 1.3);
             float largura = 0.14 + ruido * 0.05;
             float espuma = smoothstep(largura, 0.0, borda);
             gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.97, 0.98), espuma * 0.55);
             // A espuma também fecha a lâmina: na borda ela deixa de ser
             // transparente, que é o que esconde a costura com a pedra.
             gl_FragColor.a = mix(gl_FragColor.a, 1.0, espuma * 0.7);
           }`,
        );
    };
    mat.customProgramCacheKey = () => 'casaAura_lamina';
    mat.needsUpdate = true;
  }

  /**
   * Intensidade solar das cáusticas, de 0 a 1. Sem sol rasante não há
   * malha de luz no fundo — à noite quem ilumina a piscina são as luzes
   * submersas, e elas não fazem cáustica focada.
   */
  set sol(v: number) {
    this.uSol.value = Math.max(0, Math.min(1, v));
  }

  atualizar(dt: number): void {
    this.uTempo.value += dt;
  }
}

export const agua = new WaterShader();
