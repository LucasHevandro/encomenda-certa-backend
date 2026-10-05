import { writeFileSync } from 'node:fs';
import { gerarOpenApi } from '../adapters/entrada/http/contrato.js';

/** Grava o openapi.json na raiz do projeto. O front gera os tipos dele com `pnpm api:tipos`. */
writeFileSync('openapi.json', `${JSON.stringify(gerarOpenApi(), null, 2)}\n`);
console.log('openapi.json atualizado.');
