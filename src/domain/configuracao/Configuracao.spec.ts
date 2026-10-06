import { CONFIGURACAO_PADRAO, descreverDias, preencherMensagem, validarConfiguracao } from './Configuracao.js';

describe('Configuracao', () => {
  it('limpa e ordena o que veio da tela', () => {
    const c = validarConfiguracao({
      ...CONFIGURACAO_PADRAO,
      nomeEstabelecimento: '  Padaria Sol ',
      corPrincipal: '#1E5B94',
      diasDeVenda: [5, 1, 3, 1],
      formasDePagamento: ['cartao', 'pix'],
      logoUrl: ' ',
    });
    expect(c).toMatchObject({ nomeEstabelecimento: 'Padaria Sol', corPrincipal: '#1e5b94', diasDeVenda: [1, 3, 5], formasDePagamento: ['pix', 'cartao'] });
    expect(c.logoUrl).toBeUndefined();
  });

  it('recusa o que não faz sentido', () => {
    expect(() => validarConfiguracao({ ...CONFIGURACAO_PADRAO, corPrincipal: 'vermelho' })).toThrow('#rrggbb');
    expect(() => validarConfiguracao({ ...CONFIGURACAO_PADRAO, diasDeVenda: [] })).toThrow('dia de venda');
    expect(() => validarConfiguracao({ ...CONFIGURACAO_PADRAO, formasDePagamento: [] })).toThrow('forma de pagamento');
    expect(() => validarConfiguracao({ ...CONFIGURACAO_PADRAO, logoUrl: 'http://inseguro.com/logo.png' })).toThrow('https');
  });

  it('descreve os dias como no balcão', () => {
    expect(descreverDias([6, 0])).toBe('sábado ou domingo');
    expect(descreverDias([1, 2, 3, 4, 5])).toBe('segunda, terça, quarta, quinta ou sexta');
    expect(descreverDias([0])).toBe('domingo');
  });

  it('preenche a mensagem e tira a linha do endereço quando não há endereço', () => {
    const texto = preencherMensagem('Olá, {cliente}!\nRetirada: {data}\n{endereco}\n{desconhecido}', { cliente: 'Ana', data: 'domingo, 04/10' });
    expect(texto).toBe('Olá, Ana!\nRetirada: domingo, 04/10\n{desconhecido}');
  });
});
