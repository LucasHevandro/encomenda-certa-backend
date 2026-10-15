import request from 'supertest';
import { AcompanhamentoPedido, Loja } from '../../src/adapters/entrada/http/contrato.js';
import { type Ambiente, abrirDia, subirAmbiente } from './ambiente.js';

/**
 * Página pública: o cliente reserva sozinho, do mesmo estoque do balcão, sem login.
 * Os dias ficam no futuro (o prazo é conferido com o relógio de verdade).
 */
describe('pedidos online', () => {
  let amb: Ambiente;
  let anonimo: ReturnType<typeof request>;
  let diaId: string;
  let passado: string;
  let ids: Record<string, string>;

  const ligar = async (mudancas: object = {}) => {
    const { body: atual } = await amb.logado.get('/configuracao');
    return amb.logado
      .put('/configuracao')
      .send({ ...atual, pedidosOnline: { ...atual.pedidosOnline, ativo: true, endereco: 'expresso-cafe', maximoPorProduto: 3, ...mudancas } });
  };
  const reservar = (corpo: object) => anonimo.post('/publico/lojas/expresso-cafe/pedidos').send({ diaId, ...corpo });

  beforeAll(async () => {
    amb = await subirAmbiente();
    anonimo = request(amb.app.getHttpServer());
    ({ diaId, ids } = await abrirDia(amb, '2027-01-03', { Frango: { preco: 5500, quantidade: 4 }, Costela: { preco: 8900, quantidade: 2 } }));
    passado = (await amb.logado.post('/dias').send({ data: '2026-10-04', producao: [{ produtoId: ids.Frango, quantidade: 5 }] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await amb.encerrar();
  });

  it('sem endereço não há página; ligada, mostra só os dias dentro do prazo', async () => {
    await anonimo.get('/publico/lojas/expresso-cafe').expect(404);
    expect((await ligar()).status).toBe(200);

    const { body } = await anonimo.get('/publico/lojas/Expresso-Cafe').expect(200);
    expect(Loja.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ nome: 'Expresso café', aceitandoPedidos: true, maximoPorProduto: 3 });
    expect(body.dias.map((d: { id: string }) => d.id)).toEqual([diaId]);
    expect(body.dias[0].produtos).toEqual([
      { produtoId: ids.Costela, nome: 'Costela', preco: 8900, disponiveis: 2 },
      { produtoId: ids.Frango, nome: 'Frango', preco: 5500, disponiveis: 4 },
    ]);
  });

  it('o cliente reserva com nome e WhatsApp, e o pedido aparece no balcão como online', async () => {
    await reservar({ cliente: { nome: 'Maria', telefone: '' }, itens: [{ produtoId: ids.Frango, quantidade: 1 }] }).expect(422);
    const acima = await reservar({ cliente: { nome: 'Maria', telefone: '44999990001' }, itens: [{ produtoId: ids.Frango, quantidade: 4 }] }).expect(422);
    expect(acima.body.mensagem).toBe('Cada pedido leva até 3 unidades de cada produto.');
    await reservar({ cliente: { nome: 'Robô', telefone: '44999990001' }, itens: [{ produtoId: ids.Frango, quantidade: 1 }], site: 'x' }).expect(422);

    const { body } = await reservar({ cliente: { nome: 'Maria', telefone: '(44) 99999-0001' }, itens: [{ produtoId: ids.Frango, quantidade: 3 }] }).expect(201);
    expect(body.codigo).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const { body: online } = await amb.logado.get(`/dias/${diaId}/pedidos?origem=online`).expect(200);
    expect(online).toHaveLength(1);
    expect(online[0]).toMatchObject({ numero: body.numero, origem: 'online', cliente: { nome: 'Maria', telefone: '44999990001' } });
    expect(online[0].registro.reservadoPor).toBe('o cliente, pela página');

    // Só sobrou 1 frango: a mesma trava do balcão responde com o máximo.
    const falta = await reservar({ cliente: { nome: 'Ana', telefone: '44999990002' }, itens: [{ produtoId: ids.Frango, quantidade: 2 }] }).expect(409);
    expect(falta.body).toMatchObject({ codigo: 'quantidade-indisponivel', maximo: 1 });
  });

  it('pelo link o cliente acompanha e cancela, sem ver o telefone', async () => {
    const { body: reserva } = await reservar({ cliente: { nome: 'Bia', telefone: '44999990003' }, itens: [{ produtoId: ids.Costela, quantidade: 1 }] }).expect(201);
    const { body, text } = await anonimo.get(`/publico/pedidos/${reserva.codigo}`).expect(200);
    expect(AcompanhamentoPedido.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ numero: reserva.numero, cliente: 'Bia', total: 8900, retirada: 'reservado', data: '2027-01-03', podeCancelar: true });
    expect(text).not.toContain('44999990003');

    const { body: cancelado } = await anonimo.post(`/publico/pedidos/${reserva.codigo}/cancelamento`).expect(200);
    expect(cancelado).toMatchObject({ retirada: 'cancelado', podeCancelar: false });
    await anonimo.post(`/publico/pedidos/${reserva.codigo}/cancelamento`).expect(409);
    await anonimo.get('/publico/pedidos/codigo-que-nao-existe-de-jeito-nenhum').expect(404);

    const [pedido] = (await amb.logado.get(`/dias/${diaId}/pedidos?busca=Bia`)).body;
    expect(pedido.registro.canceladoPor).toBe('o cliente, pela página');
  });

  it('dia com prazo vencido não recebe pedido; lista de espera funciona dentro do prazo', async () => {
    const vencido = await anonimo
      .post('/publico/lojas/expresso-cafe/pedidos')
      .send({ diaId: passado, cliente: { nome: 'Caio', telefone: '44999990004' }, itens: [{ produtoId: ids.Frango, quantidade: 1 }] })
      .expect(409);
    expect(vencido.body.codigo).toBe('pedidos-online-encerrados');

    const { body: espera } = await anonimo
      .post('/publico/lojas/expresso-cafe/espera')
      .send({ diaId, produtoId: ids.Frango, cliente: { nome: 'Caio', telefone: '44999990004' }, quantidade: 2 })
      .expect(201);
    expect(espera).toMatchObject({ posicao: 1, cliente: { nome: 'Caio', telefone: '44999990004' } });
  });

  it('o mesmo telefone tem no máximo 3 pedidos reservados no dia', async () => {
    await amb.logado.put(`/dias/${diaId}/producao`).send({ quantidades: [{ produtoId: ids.Costela, quantidade: 10 }] }).expect(204);
    const davi = () => reservar({ cliente: { nome: 'Davi', telefone: '44999990005' }, itens: [{ produtoId: ids.Costela, quantidade: 1 }] });
    for (let i = 0; i < 3; i++) await davi().expect(201);
    const quarto = await davi().expect(429);
    expect(quarto.body.codigo).toBe('muitos-pedidos');
  });

  it('endereço é único no sistema, e desligar fecha a página para pedidos', async () => {
    await amb.admin
      .post('/admin/empresas')
      .send({ nome: 'Outra', usuario: { nome: 'Rui', email: 'rui@outra.com', senha: 'senha-forte-123' } })
      .expect(201);
    const outra = request.agent(amb.app.getHttpServer());
    await outra.post('/sessao').send({ email: 'rui@outra.com', senha: 'senha-forte-123' }).expect(200);
    const { body: atual } = await outra.get('/configuracao');
    const conflito = await outra
      .put('/configuracao')
      .send({ ...atual, pedidosOnline: { ...atual.pedidosOnline, ativo: true, endereco: 'expresso-cafe' } })
      .expect(409);
    expect(conflito.body.codigo).toBe('endereco-em-uso');

    expect((await ligar({ ativo: false })).status).toBe(200);
    const { body } = await anonimo.get('/publico/lojas/expresso-cafe').expect(200);
    expect(body).toMatchObject({ aceitandoPedidos: false, dias: [] });
    const fechado = await reservar({ cliente: { nome: 'Eva', telefone: '44999990006' }, itens: [{ produtoId: ids.Frango, quantidade: 1 }] }).expect(409);
    expect(fechado.body.codigo).toBe('pedidos-online-fechados');
  });
});
