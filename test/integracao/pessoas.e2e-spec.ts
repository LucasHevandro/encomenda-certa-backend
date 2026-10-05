import request from 'supertest';
import { type Ambiente, abrirDia, subirAmbiente } from './ambiente.js';

describe('pessoas, quem fez e reativação', () => {
  let amb: Ambiente;

  beforeAll(async () => {
    amb = await subirAmbiente();
  });

  afterAll(async () => {
    await amb.encerrar();
  });

  it('cria outra pessoa, que entra e troca a própria senha', async () => {
    const { body: nova } = await amb.logado.post('/usuarios').send({ nome: 'Maria', email: 'Maria@Expressocafe.com', senha: 'senha-da-maria' }).expect(201);
    expect(nova).toEqual({ id: expect.any(String), nome: 'Maria', email: 'maria@expressocafe.com' });
    await amb.logado.post('/usuarios').send({ nome: 'Outra', email: 'maria@expressocafe.com', senha: 'qualquer-senha' }).expect(409);
    await amb.logado.post('/usuarios').send({ nome: 'Curta', email: 'curta@expressocafe.com', senha: '123' }).expect(422);
    const { body: lista } = await amb.logado.get('/usuarios').expect(200);
    expect(lista.map((u: { nome: string }) => u.nome)).toEqual(['Lusca', 'Maria']);
    expect(JSON.stringify(lista)).not.toContain('senha');

    const maria = request.agent(amb.app.getHttpServer());
    await maria.post('/sessao').send({ email: 'maria@expressocafe.com', senha: 'senha-da-maria' }).expect(200);
    await maria.put('/sessao/senha').send({ senhaAtual: 'errada', novaSenha: 'nova-senha-123' }).expect(422);
    await maria.put('/sessao/senha').send({ senhaAtual: 'senha-da-maria', novaSenha: 'nova-senha-123' }).expect(204);
    await request(amb.app.getHttpServer()).post('/sessao').send({ email: 'maria@expressocafe.com', senha: 'senha-da-maria' }).expect(401);
    await request(amb.app.getHttpServer()).post('/sessao').send({ email: 'maria@expressocafe.com', senha: 'nova-senha-123' }).expect(200);
  });

  it('depois de 5 senhas erradas, nem a certa entra por um tempo', async () => {
    await amb.logado.post('/usuarios').send({ nome: 'Rita', email: 'rita@expressocafe.com', senha: 'senha-da-rita' }).expect(201);
    const anonimo = request(amb.app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      await anonimo.post('/sessao').send({ email: 'rita@expressocafe.com', senha: `errada-${i}` }).expect(401);
    }
    const { body } = await anonimo.post('/sessao').send({ email: 'rita@expressocafe.com', senha: 'senha-da-rita' }).expect(429);
    expect(body).toMatchObject({ codigo: 'muitas-tentativas', mensagem: expect.stringContaining('15 minutos') });
    // Outro e-mail do mesmo endereço continua entrando.
    await anonimo.post('/sessao').send({ email: 'lusca@expressocafe.com', senha: 'senha-forte-123' }).expect(200);
  });

  it('o pedido mostra quem reservou, retirou e cancelou', async () => {
    const { diaId, ids } = await abrirDia(amb, '2026-10-04', { Frango: { preco: 5500, quantidade: 10 } });
    const { body: pedido } = await amb.logado
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'Ana' }, itens: [{ produtoId: ids.Frango, quantidade: 1 }] })
      .expect(201);
    expect(pedido.registro).toMatchObject({ reservadoPor: 'Lusca', reservadoEm: expect.any(String) });
    expect(pedido.registro.retiradoPor).toBeUndefined();

    const { body: retirado } = await amb.logado.post(`/pedidos/${pedido.id}/retirada`).expect(200);
    expect(retirado.registro).toMatchObject({ reservadoPor: 'Lusca', retiradoPor: 'Lusca', retiradoEm: expect.any(String) });
  });

  it('reativa pedido cancelado quando ainda cabe, e recusa quando as unidades já foram vendidas', async () => {
    const { diaId, ids } = await abrirDia(amb, '2026-10-11', { Pernil: { preco: 6990, quantidade: 2 } });
    const reservar = (nome: string, quantidade: number) =>
      amb.logado.post(`/dias/${diaId}/pedidos`).send({ cliente: { nome }, itens: [{ produtoId: ids.Pernil, quantidade }] });

    const { body: p1 } = await reservar('Ana', 2).expect(201);
    await amb.logado.post(`/pedidos/${p1.id}/cancelamento`).expect(200);
    await amb.logado.get(`/pedidos/${p1.id}`).expect(200).expect((r) => expect(r.body.registro.canceladoPor).toBe('Lusca'));

    // Ainda cabe: volta a ser reservado e o registro do cancelamento some.
    const { body: reativado } = await amb.logado.post(`/pedidos/${p1.id}/reativacao`).expect(200);
    expect(reativado).toMatchObject({ retirada: 'reservado', numero: p1.numero });
    expect(reativado.registro.canceladoPor).toBeUndefined();
    await amb.logado.post(`/pedidos/${p1.id}/reativacao`).expect(409);

    // As unidades foram para outra pessoa: reativar mostra o máximo.
    await amb.logado.post(`/pedidos/${p1.id}/cancelamento`).expect(200);
    await reservar('Bruno', 1).expect(201);
    const { body: recusa } = await amb.logado.post(`/pedidos/${p1.id}/reativacao`).expect(409);
    expect(recusa).toMatchObject({ codigo: 'quantidade-indisponivel', maximo: 1, solicitado: 2 });
  });
});
