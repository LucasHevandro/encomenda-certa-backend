import { LimiteDeTentativas } from './limiteDeTentativas.js';

describe('LimiteDeTentativas', () => {
  const minuto = 60_000;

  it('bloqueia depois de 5 erros seguidos e libera depois da janela', () => {
    let agora = 0;
    const limite = new LimiteDeTentativas({ maximo: 5, janelaMs: 15 * minuto }, () => agora);
    for (let i = 0; i < 4; i++) limite.registrarErro('ip|a@b.com');
    expect(() => limite.conferir('ip|a@b.com')).not.toThrow();
    limite.registrarErro('ip|a@b.com');
    expect(() => limite.conferir('ip|a@b.com')).toThrow('Tente de novo em 15 minutos');
    agora = 14 * minuto + 1;
    expect(() => limite.conferir('ip|a@b.com')).toThrow('1 minuto');
    agora = 15 * minuto + 1;
    expect(() => limite.conferir('ip|a@b.com')).not.toThrow();
  });

  it('acertar zera a conta, e erros antigos saem da janela', () => {
    let agora = 0;
    const limite = new LimiteDeTentativas({ maximo: 3, janelaMs: 10 * minuto }, () => agora);
    limite.registrarErro('x');
    limite.registrarErro('x');
    limite.registrarAcerto('x');
    limite.registrarErro('x');
    limite.registrarErro('x');
    expect(() => limite.conferir('x')).not.toThrow();
    agora = 11 * minuto;
    limite.registrarErro('x');
    expect(() => limite.conferir('x')).not.toThrow();
  });

  it('cada e-mail e endereço tem sua própria conta', () => {
    const limite = new LimiteDeTentativas({ maximo: 1, janelaMs: minuto });
    limite.registrarErro('ip1|a@b.com');
    expect(() => limite.conferir('ip1|a@b.com')).toThrow();
    expect(() => limite.conferir('ip2|a@b.com')).not.toThrow();
  });
});
