// @ts-nocheck
// RODADA 4 — só o contraste entre peças, com tudo o mais fechado.
//
// Fechado nas rodadas anteriores: 10 fiadas, junta de 5 mm rasa
// (depth 0,26) e discreta (albedoCavity 0,35), piso de tom em 104.
// Falta a amplitude do degrau de tom. Com peça de 16 cm ela é bem
// visível (ao contrário do que valia com peça de 53 cm), então o risco
// agora é o oposto do original: contraste demais lê como LISTRA, não
// como pedra.
import { montarBancada, ATUAL } from '../src/legado/pedra-lab';

const fina = {
  ...ATUAL, courses: 10, jointWidth: 0.003, depth: 0.26,
  albedoCavity: 0.35, tomBase: 104,
};

montarBancada([
  { ...ATUAL, nome: '1. ATUAL (controle)', nota: 'O bloco de concreto de hoje.' },
  { ...fina, nome: '2. Faixa de tom 24', tomFaixa: 24, nota: 'Calma. Risco: sem vida.' },
  { ...fina, nome: '3. Faixa de tom 32', tomFaixa: 32, nota: 'Meio-termo.' },
  { ...fina, nome: '4. Faixa de tom 40', tomFaixa: 40, nota: 'Viva. Risco: listrada.' },
], 512);
