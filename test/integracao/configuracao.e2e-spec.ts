import request from 'supertest';
import { type Ambiente, abrirDia, subirAmbiente } from './ambiente.js';

describe('configurações do estabelecimento', () => {
  let amb: Ambiente;

  beforeAll(async () => {
    amb = await subirAmbiente();
  });

  afterAll(async () => {
    await amb.encerrar();
  });

  it('sem nada salvo valem os padrões, e qualquer um pode ler (a tela de login usa)', async () => {
    const { body } = await request(amb.app.getHttpServer()).get('/configuracao').expect(200);
    expect(body).toMatchObject({ nomeEstabelecimento: 'Expresso café', diasDeVenda: [6, 0], limiteAtencao: 3, formasDePagamento: ['pix', 'dinheiro', 'cartao'] });
    await request(amb.app.getHttpServer()).put('/configuracao').send(body).expect(401);
  });

  it('salvar muda os dias de venda e as formas de pagamento aceitas', async () => {
    const { body: atual } = await amb.logado.get('/configuracao');
    const { body: salva } = await amb.logado
      .put('/configuracao')
      .send({ ...atual, nomeEstabelecimento: ' Padaria Sol ', corPrincipal: '#1E5B94', diasDeVenda: [5, 1, 2, 3, 4], formasDePagamento: ['pix'] })
      .expect(200);
    expect(salva).toMatchObject({ nomeEstabelecimento: 'Padaria Sol', corPrincipal: '#1e5b94', diasDeVenda: [1, 2, 3, 4, 5] });
    await amb.logado.put('/configuracao').send({ ...salva, corPrincipal: 'azul' }).expect(422);

    // Sábado não é mais dia de venda; segunda é.
    const { body: recusa } = await amb.logado.post('/dias').send({ data: '2026-10-10', producao: [] }).expect(422);
    expect(recusa.mensagem).toBe('Escolha um dia de venda: segunda, terça, quarta, quinta ou sexta.');
    const { diaId, ids } = await abrirDia(amb, '2026-10-12', { Pão: { preco: 100, quantidade: 50 } });

    const { body: pedido } = await amb.logado
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'Ana' }, itens: [{ produtoId: ids['Pão'], quantidade: 10 }] })
      .expect(201);
    await amb.logado.put(`/pedidos/${pedido.id}/pagamento`).send({ pagamento: 'cartao' }).expect(422);
    await amb.logado.put(`/pedidos/${pedido.id}/pagamento`).send({ pagamento: 'pix' }).expect(200);
  });
});
