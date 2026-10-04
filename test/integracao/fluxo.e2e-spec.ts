import request from 'supertest';
import { type Ambiente, abrirDia, subirAmbiente } from './ambiente.js';

/** Um domingo inteiro pela API, na mesma ordem do balcão. */
describe('fluxo do dia de venda', () => {
  let amb: Ambiente;

  beforeAll(async () => {
    amb = await subirAmbiente();
  });

  afterAll(async () => {
    await amb.encerrar();
  });

  it('sem sessão a API recusa; senha errada não entra', async () => {
    const anonimo = request(amb.app.getHttpServer());
    await anonimo.get('/dias').expect(401, { codigo: 'sessao-expirada', mensagem: 'Sua sessão terminou. Entre de novo.' });
    await anonimo.post('/sessao').send({ email: 'lusca@expressocafe.com', senha: 'errada' }).expect(401);
    await anonimo.get('/saude').expect(200);
    const { body } = await amb.logado.get('/sessao').expect(200);
    expect(body).toMatchObject({ nome: 'Lusca', email: 'lusca@expressocafe.com' });
  });

  it('reserva, edita, paga, retira, cancela, ajusta a produção e fecha', async () => {
    const { diaId, ids } = await abrirDia(amb, '2026-10-04', {
      Frango: { preco: 5500, quantidade: 10 },
      Maionese: { preco: 2500, quantidade: 5 },
    });
    const api = amb.logado;

    // Reserva com telefone: o cliente nasce e é reconhecido depois.
    const { body: p1 } = await api
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'João', telefone: '(44) 99999-9999' }, itens: [{ produtoId: ids.Frango, quantidade: 3 }] })
      .expect(201);
    expect(p1).toMatchObject({ retirada: 'reservado', pagamento: 'pendente', cliente: { nome: 'João', telefone: '44999999999' } });
    expect(p1.itens[0]).toMatchObject({ nome: 'Frango', quantidade: 3, precoUnitario: 5500 });
    const { body: encontrados } = await api.get('/clientes?telefone=44999999999').expect(200);
    expect(encontrados).toEqual([expect.objectContaining({ nome: 'João', pedidosAnteriores: 1 })]);

    // Mudar o preço não mexe no pedido já feito; editar mantém o preço da época.
    await api.patch(`/produtos/${ids.Frango}`).send({ preco: 6000 }).expect(200);
    const { body: editado } = await api
      .patch(`/pedidos/${p1.id}`)
      .send({ itens: [{ produtoId: ids.Frango, quantidade: 4 }, { produtoId: ids.Maionese, quantidade: 1 }] })
      .expect(200);
    expect(editado.itens.find((i: { produtoId: string }) => i.produtoId === ids.Frango).precoUnitario).toBe(5500);

    // Editar conta as unidades do próprio pedido: 4 dele + 6 livres = até 10.
    await api.patch(`/pedidos/${p1.id}`).send({ itens: [{ produtoId: ids.Frango, quantidade: 10 }] }).expect(200);
    await api.patch(`/pedidos/${p1.id}`).send({ itens: [{ produtoId: ids.Frango, quantidade: 11 }] }).expect(409);
    await api.patch(`/pedidos/${p1.id}`).send({ itens: [{ produtoId: ids.Frango, quantidade: 4 }] }).expect(200);

    // Pagamento é independente da retirada.
    const { body: pago } = await api.put(`/pedidos/${p1.id}/pagamento`).send({ pagamento: 'pix' }).expect(200);
    expect(pago).toMatchObject({ retirada: 'reservado', pagamento: 'pix' });
    await api.post(`/pedidos/${p1.id}/retirada`).expect(200);
    await api.post(`/pedidos/${p1.id}/retirada`).expect(409);

    // Lista de espera e cancelamento que libera unidades.
    const { body: p2 } = await api
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'Maria' }, itens: [{ produtoId: ids.Maionese, quantidade: 5 }] })
      .expect(201);
    const { body: espera } = await api
      .post(`/dias/${diaId}/espera`)
      .send({ produtoId: ids.Maionese, cliente: { nome: 'Rita' }, quantidade: 2 })
      .expect(201);
    expect(espera).toMatchObject({ posicao: 1, status: 'aguardando' });
    const { body: cancelamento } = await api.post(`/pedidos/${p2.id}/cancelamento`).expect(200);
    expect(cancelamento).toEqual({ unidadesLiberadas: 5, clientesAguardando: 1 });
    await api.patch(`/espera/${espera.id}`).send({ status: 'atendido' }).expect(200);

    // Produção não pode ficar abaixo de reservados + vendidos (4 frangos vendidos).
    const { body: abaixo } = await api
      .put(`/dias/${diaId}/producao`)
      .send({ quantidades: [{ produtoId: ids.Frango, quantidade: 3 }] })
      .expect(409);
    expect(abaixo).toMatchObject({ codigo: 'producao-abaixo-do-comprometido', minimo: 4 });
    await api.put(`/dias/${diaId}/producao`).send({ quantidades: [{ produtoId: ids.Frango, quantidade: 12 }] }).expect(204);
    const { body: historico } = await api.get(`/dias/${diaId}/producao/historico`).expect(200);
    expect(historico).toEqual([expect.objectContaining({ de: 10, para: 12, usuario: 'Lusca' })]);

    const { body: painel } = await api.get(`/dias/${diaId}/painel`).expect(200);
    expect(painel).toMatchObject({ pedidos: 1, aguardandoRetirada: 0, valorReservado: 0 });

    // Busca por nome, telefone e número.
    expect((await api.get(`/dias/${diaId}/pedidos?busca=joão`).expect(200)).body).toHaveLength(1);
    expect((await api.get(`/dias/${diaId}/pedidos?retirada=cancelado`).expect(200)).body).toHaveLength(1);

    // Fechar: grava a foto e o dia passa a recusar escrita.
    await api.post(`/dias/${diaId}/fechamento`).expect(204);
    await api
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'Tarde' }, itens: [{ produtoId: ids.Frango, quantidade: 1 }] })
      .expect(409, { codigo: 'dia-encerrado', mensagem: 'Este dia já foi fechado e não recebe mais alterações.' });
    const { body: dias } = await api.get('/dias').expect(200);
    const fechado = dias.find((d: { dia: { id: string } }) => d.dia.id === diaId);
    expect(fechado).toMatchObject({ dia: { status: 'encerrado' }, faturamento: 4 * 5500, sobras: 8 + 5 });

    // O próximo dia sugere a produção do último fechado.
    const { body: sugestao } = await api.get('/dias/sugestao-producao').expect(200);
    expect(sugestao.find((s: { produtoId: string }) => s.produtoId === ids.Frango)).toMatchObject({ ultimo: 12, media: 12, sobraMedia: 8 });
  });

  it('avisa os outros aparelhos em tempo real (SSE)', async () => {
    const { diaId, ids } = await abrirDia(amb, '2026-11-01', { Frango: { preco: 5500, quantidade: 5 } });
    const login = await amb.logado.get('/sessao');
    const cookie = String(login.request.cookies ?? '');
    const endereco = amb.app.getHttpServer().address() as { port: number };
    const controle = new AbortController();
    const resposta = await fetch(`http://localhost:${endereco.port}/dias/${diaId}/eventos`, {
      headers: { cookie },
      signal: controle.signal,
    });
    expect(resposta.headers.get('content-type')).toContain('text/event-stream');
    const leitor = resposta.body!.getReader();

    const { body: pedido } = await amb.logado
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'Ana' }, itens: [{ produtoId: ids.Frango, quantidade: 2 }] })
      .expect(201);
    await amb.logado.post(`/pedidos/${pedido.id}/cancelamento`).expect(200);

    let recebido = '';
    while (!recebido.includes('unidades-liberadas')) {
      const { value, done } = await leitor.read();
      if (done) break;
      recebido += new TextDecoder().decode(value);
    }
    controle.abort();
    expect(recebido).toContain('event: disponibilidade-mudou');
    expect(recebido).toContain('event: unidades-liberadas');
    expect(recebido).toContain(`"produtoId":"${ids.Frango}","quantidade":2`);
  });

  it('recusa dia útil e data repetida', async () => {
    await amb.logado.post('/dias').send({ data: '2026-10-07', producao: [] }).expect(422);
    await amb.logado.post('/dias').send({ data: '2026-10-25', producao: [] }).expect(201);
    await amb.logado.post('/dias').send({ data: '2026-10-25', producao: [] }).expect(409);
  });

  it('id que não existe responde 404', async () => {
    await amb.logado.get('/pedidos/nao-existe').expect(404);
    await amb.logado.get('/dias/00000000-0000-0000-0000-000000000000/painel').expect(404);
  });
});
