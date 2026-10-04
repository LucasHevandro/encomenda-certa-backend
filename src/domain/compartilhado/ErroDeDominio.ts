/** Erro de regra de negócio. A tela decide como mostrar a partir do `codigo`. */
export class ErroDeDominio extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = new.target.name;
  }
}
