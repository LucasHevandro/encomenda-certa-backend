import type { z } from 'zod';
import { ROTAS } from '../../src/adapters/entrada/http/contrato.js';
import { type Ambiente, abrirDia, subirAmbiente } from './ambiente.js';

/**
 * As respostas reais batem com o contrato publicado no openapi.json.
 * Se uma rota mudar de formato sem atualizar o contrato, este teste falha.
 */
describe('contrato da API', () => {
  let amb: Ambiente;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    amb = await subirAmbiente();
    const { diaId, ids: produtos } = await abrirDia(amb, '2026-10-04', { Frango: { preco: 5500, quantidade: 10 } });
    const api = amb.logado;
    const { body: pedido } = await api
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'Ana', telefone: '44999990000' }, itens: [{ produtoId: produtos.Frango, quantidade: 2 }] });
    const { body: espera } = await api.post(`/dias/${diaId}/espera`).send({ produtoId: produtos.Frango, cliente: { nome: 'Bia' }, quantidade: 1 });
    const [cliente] = (await api.get('/clientes?telefone=44999990000')).body;
    // Um dia fechado para o relatório.
    const fechado = await abrirDia(amb, '2026-09-27', { Pernil: { preco: 6990, quantidade: 5 } });
    await api.post(`/dias/${fechado.diaId}/fechamento`);
    Object.assign(ids, { dia: diaId, pedido: pedido.id, espera: espera.id, cliente: cliente.id, produto: produtos.Frango });
  });

  afterAll(async () => {
    await amb.encerrar();
  });

  const leituras = ROTAS.filter((r) => r.metodo === 'get' && r.resposta && !r.caminho.endsWith('/eventos'));

  it.each(leituras.map((r) => [r.caminho, r] as const))('GET %s', async (caminho, rota) => {
    const id = caminho.startsWith('/pedidos') ? ids.pedido : caminho.startsWith('/clientes') ? ids.cliente : ids.dia;
    const { body } = await amb.logado.get(caminho.replace('{id}', id)).expect(200);
    const resultado = (rota.resposta as z.ZodType).safeParse(body);
    expect(resultado.success ? 'ok' : resultado.error.issues).toBe('ok');
  });

  it('cada rota do contrato existe na API', async () => {
    await amb.logado.get('/nao-existe').expect(404, { codigo: 'rota-inexistente', mensagem: 'Cannot GET /nao-existe' });
    for (const rota of ROTAS) {
      const caminho = rota.caminho.replace('{id}', '00000000-0000-0000-0000-000000000000');
      const resposta = await amb.logado[rota.metodo](caminho).send(rota.corpo ? {} : undefined);
      // Rota que não existe responde "rota-inexistente"; as que existem podem recusar os dados, mas não com esse código.
      expect(resposta.body?.codigo === 'rota-inexistente' ? `${rota.metodo} ${rota.caminho} não existe` : 'ok').toBe('ok');
    }
  });
});
