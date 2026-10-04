import { type Ambiente, abrirDia, subirAmbiente } from './ambiente.js';

/** A parte mais arriscada do sistema: nunca reservar mais do que foi produzido, nem com dois aparelhos ao mesmo tempo. */
describe('reserva com trava no banco', () => {
  let amb: Ambiente;

  beforeAll(async () => {
    amb = await subirAmbiente({ janelaDeCorridaMs: 150 });
  });

  afterAll(async () => {
    await amb.encerrar();
  });

  it('dois aparelhos pedem o último frango no mesmo segundo: só um leva', async () => {
    const { diaId, ids } = await abrirDia(amb, '2026-10-04', { 'Frango assado': { preco: 5500, quantidade: 1 } });
    const pedir = (nome: string) =>
      amb.logado.post(`/dias/${diaId}/pedidos`).send({ cliente: { nome }, itens: [{ produtoId: ids['Frango assado'], quantidade: 1 }] });

    const respostas = await Promise.all([pedir('Celular'), pedir('Tablet')]);
    const status = respostas.map((r) => r.status).sort((a, b) => a - b);
    expect(status).toEqual([201, 409]);

    const recusada = respostas.find((r) => r.status === 409)!;
    expect(recusada.body).toMatchObject({ codigo: 'quantidade-indisponivel', maximo: 0, produtoId: ids['Frango assado'] });

    const { body: painel } = await amb.logado.get(`/dias/${diaId}/painel`).expect(200);
    expect(painel.estoques[0]).toMatchObject({ producao: 1, reservados: 1, vendidos: 0 });
  });

  it('vinte pedidos simultâneos para dez costelas: exatamente dez passam', async () => {
    const { diaId, ids } = await abrirDia(amb, '2026-10-11', { Costela: { preco: 8990, quantidade: 10 } });
    const respostas = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        amb.logado.post(`/dias/${diaId}/pedidos`).send({ cliente: { nome: `Cliente ${i}` }, itens: [{ produtoId: ids.Costela, quantidade: 1 }] }),
      ),
    );
    expect(respostas.filter((r) => r.status === 201)).toHaveLength(10);
    expect(respostas.filter((r) => r.status === 409)).toHaveLength(10);

    const { body: painel } = await amb.logado.get(`/dias/${diaId}/painel`).expect(200);
    expect(painel.estoques[0]).toMatchObject({ producao: 10, reservados: 10 });
    // Números do pedido seguem uma sequência sem repetir.
    const numeros = respostas.filter((r) => r.status === 201).map((r) => r.body.numero);
    expect(new Set(numeros).size).toBe(10);
  });

  it('pedido maior que o disponível devolve o máximo exato para o "Reservar N"', async () => {
    const { diaId, ids } = await abrirDia(amb, '2026-10-18', { Pernil: { preco: 6990, quantidade: 5 } });
    const { body } = await amb.logado
      .post(`/dias/${diaId}/pedidos`)
      .send({ cliente: { nome: 'Ana' }, itens: [{ produtoId: ids.Pernil, quantidade: 7 }] })
      .expect(409);
    expect(body).toMatchObject({ codigo: 'quantidade-indisponivel', solicitado: 7, maximo: 5, nome: 'Pernil' });
    expect(body.mensagem).toContain('5');
  });
});
