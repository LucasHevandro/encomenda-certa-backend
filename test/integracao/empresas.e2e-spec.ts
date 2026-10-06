import request from 'supertest';
import { type Ambiente, abrirDia, subirAmbiente } from './ambiente.js';

/** Cada empresa só enxerga o que é dela; o administrador cria, desativa e reativa empresas. */
describe('empresas', () => {
  let amb: Ambiente;
  let sol: ReturnType<typeof request.agent>;
  let solId: string;
  const expresso: Record<string, string> = {};

  beforeAll(async () => {
    amb = await subirAmbiente();
    const { diaId, ids } = await abrirDia(amb, '2026-10-04', { Frango: { preco: 5500, quantidade: 10 } });
    const { body: pedido } = await amb.logado
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'Ana', telefone: '44999990000' }, itens: [{ produtoId: ids.Frango, quantidade: 1 }] })
      .expect(201);
    Object.assign(expresso, { dia: diaId, produto: ids.Frango, pedido: pedido.id });

    const { body } = await amb.admin
      .post('/admin/empresas')
      .send({ nome: 'Padaria Sol', usuario: { nome: 'Bia', email: 'bia@sol.com', senha: 'senha-da-bia-1' } })
      .expect(201);
    solId = body.empresa.id;
    expect(body).toMatchObject({ empresa: { nome: 'Padaria Sol', ativa: true, usuarios: 1 }, usuario: { email: 'bia@sol.com', administrador: false } });
    sol = request.agent(amb.app.getHttpServer());
    await sol.post('/sessao').send({ email: 'bia@sol.com', senha: 'senha-da-bia-1' }).expect(200);
  });

  afterAll(async () => {
    await amb.encerrar();
  });

  it('o painel é só do administrador, e o administrador não usa o balcão', async () => {
    await amb.logado.get('/admin/empresas').expect(403);
    await sol.post('/admin/empresas').send({ nome: 'X', usuario: { nome: 'X', email: 'x@x.com', senha: 'senha-forte-123' } }).expect(403);
    const { body } = await amb.admin.get('/dias').expect(403);
    expect(body.codigo).toBe('so-empresa');
    expect((await amb.admin.get('/sessao').expect(200)).body).toMatchObject({ administrador: true });
    const { body: empresas } = await amb.admin.get('/admin/empresas').expect(200);
    expect(empresas.map((e: { nome: string }) => e.nome)).toEqual(['Expresso café', 'Padaria Sol']);
  });

  it('a nova empresa começa vazia, com o próprio nome', async () => {
    expect((await sol.get('/produtos').expect(200)).body).toEqual([]);
    expect((await sol.get('/dias').expect(200)).body).toEqual([]);
    expect((await sol.get('/clientes').expect(200)).body).toEqual([]);
    expect((await sol.get('/usuarios').expect(200)).body.map((u: { email: string }) => u.email)).toEqual(['bia@sol.com']);
    expect((await sol.get('/configuracao').expect(200)).body.nomeEstabelecimento).toBe('Padaria Sol');
    expect((await amb.logado.get('/configuracao').expect(200)).body.nomeEstabelecimento).toBe('Expresso café');
  });

  it('não lê nem mexe no que é de outra empresa', async () => {
    await sol.get(`/dias/${expresso.dia}/painel`).expect(404);
    await sol.get(`/dias/${expresso.dia}/producao`).expect(404);
    expect((await sol.get(`/dias/${expresso.dia}/pedidos`).expect(200)).body).toEqual([]);
    expect((await sol.get(`/dias/${expresso.dia}/producao/historico`).expect(200)).body).toEqual([]);
    await sol.get(`/pedidos/${expresso.pedido}`).expect(404);
    await sol.post(`/pedidos/${expresso.pedido}/cancelamento`).expect(404);
    await sol.patch(`/produtos/${expresso.produto}`).send({ preco: 1 }).expect(404);
    await sol
      .post(`/dias/${expresso.dia}/pedidos`)
      .send({ cliente: { nome: 'Intrusa' }, itens: [{ produtoId: expresso.produto, quantidade: 1 }] })
      .expect(404);
    expect((await sol.get('/clientes?telefone=44999990000').expect(200)).body).toEqual([]);
    // O pedido do Expresso continua intacto.
    expect((await amb.logado.get(`/pedidos/${expresso.pedido}`).expect(200)).body.retirada).toBe('reservado');
  });

  it('mesma data, mesmo telefone e numeração própria em cada empresa', async () => {
    const { body: produto } = await sol.post('/produtos').send({ nome: 'Pão', preco: 100 }).expect(201);
    const { body: dia } = await sol
      .post('/dias')
      .send({ data: '2026-10-04', producao: [{ produtoId: produto.id, quantidade: 5 }] })
      .expect(201);
    const { body: pedido } = await sol
      .post(`/dias/${dia.id}/pedidos`)
      .send({ cliente: { nome: 'Ana da Sol', telefone: '44999990000' }, itens: [{ produtoId: produto.id, quantidade: 1 }] })
      .expect(201);
    expect(pedido.numero).toBe(1);
    // O cliente do Expresso com o mesmo telefone não mudou de nome.
    expect((await amb.logado.get('/clientes?telefone=44999990000').expect(200)).body[0].nome).toBe('Ana');
    const { body: seguinte } = await amb.logado
      .post(`/dias/${expresso.dia}/pedidos`)
      .send({ cliente: { nome: 'Caio' }, itens: [{ produtoId: expresso.produto, quantidade: 1 }] })
      .expect(201);
    expect(seguinte.numero).toBe(2);
  });

  it('desativada, ninguém da empresa entra; reativada, volta a funcionar', async () => {
    expect((await amb.admin.patch(`/admin/empresas/${solId}`).send({ ativa: false }).expect(200)).body.ativa).toBe(false);
    const { body } = await sol.get('/produtos').expect(403);
    expect(body.codigo).toBe('empresa-inativa');
    await request(amb.app.getHttpServer()).post('/sessao').send({ email: 'bia@sol.com', senha: 'senha-da-bia-1' }).expect(403);
    // As outras empresas seguem normais.
    await amb.logado.get('/produtos').expect(200);

    await amb.admin.patch(`/admin/empresas/${solId}`).send({ ativa: true }).expect(200);
    expect((await sol.get('/produtos').expect(200)).body).toHaveLength(1);
  });

  it('sem login, a configuração vem com os padrões', async () => {
    const { body } = await request(amb.app.getHttpServer()).get('/configuracao').expect(200);
    expect(body.nomeEstabelecimento).toBe('Encomenda Certa');
  });

  it('recusa empresa sem nome e e-mail que já existe', async () => {
    await amb.admin
      .post('/admin/empresas')
      .send({ nome: ' ', usuario: { nome: 'X', email: 'x@x.com', senha: 'senha-forte-123' } })
      .expect(422);
    const { body } = await amb.admin
      .post('/admin/empresas')
      .send({ nome: 'Outra', usuario: { nome: 'X', email: 'bia@sol.com', senha: 'senha-forte-123' } })
      .expect(409);
    expect(body.codigo).toBe('email-ja-existe');
    // Nada ficou pela metade: a empresa "Outra" não foi criada.
    expect((await amb.admin.get('/admin/empresas').expect(200)).body).toHaveLength(2);
  });
});
