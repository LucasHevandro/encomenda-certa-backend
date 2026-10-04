import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Observable, Subject, filter, map } from 'rxjs';
import type { EventoDoDia, HashDeSenha, PublicadorDeEventos, Relogio } from '../../application/portas/servicos.js';

const scryptAsync = promisify(scrypt) as (senha: string, sal: Buffer, tamanho: number) => Promise<Buffer>;

/** scrypt do próprio Node: sem dependência nativa para compilar. Formato "scrypt$sal$hash". */
export class HashScrypt implements HashDeSenha {
  async gerar(senha: string): Promise<string> {
    const sal = randomBytes(16);
    const hash = await scryptAsync(senha, sal, 64);
    return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
  }

  async conferir(senha: string, guardado: string): Promise<boolean> {
    const [algoritmo, sal, hash] = guardado.split('$');
    if (algoritmo !== 'scrypt' || !sal || !hash) return false;
    const esperado = Buffer.from(hash, 'base64');
    const calculado = await scryptAsync(senha, Buffer.from(sal, 'base64'), esperado.length);
    return timingSafeEqual(esperado, calculado);
  }
}

export class RelogioDoSistema implements Relogio {
  agora() {
    return new Date();
  }
}

/**
 * Eventos em memória do processo, entregues por SSE em GET /dias/:id/eventos.
 * Com mais de uma instância da API, troque por Postgres LISTEN/NOTIFY ou Redis.
 */
export class PublicadorSSE implements PublicadorDeEventos {
  private readonly saida = new Subject<{ diaId: string; evento: EventoDoDia }>();

  publicar(diaId: string, evento: EventoDoDia): void {
    this.saida.next({ diaId, evento });
  }

  doDia(diaId: string): Observable<EventoDoDia> {
    return this.saida.pipe(
      filter((m) => m.diaId === diaId),
      map((m) => m.evento),
    );
  }
}
