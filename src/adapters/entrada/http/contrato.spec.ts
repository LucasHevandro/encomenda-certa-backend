import { readFileSync } from 'node:fs';
import { gerarOpenApi } from './contrato.js';

describe('openapi.json', () => {
  it('está atualizado com o contrato (rode pnpm openapi depois de mudar uma rota)', () => {
    const gravado = JSON.parse(readFileSync('openapi.json', 'utf8'));
    expect(gravado).toEqual(JSON.parse(JSON.stringify(gerarOpenApi())));
  });
});
