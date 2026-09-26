/* Quién puede llamar a las funciones que corren solas.
 *
 * `expire-holds` y `reporte-semanal` no llevan JWT: las llama pg_cron desde la
 * base, no una persona con sesión. Lo único que las protege es un secreto
 * compartido en la cabecera `x-cron-secret`.
 *
 * Ese secreto se genera dentro de Postgres y se guarda en `privado.secretos`,
 * no en un archivo del repo. Es a propósito: una migración con un secreto
 * adentro queda en git para siempre, y rotarlo obligaría a reescribir la
 * historia. Acá el cron lee el valor de la tabla y la función lo consulta por
 * RPC; nadie tiene que copiarlo a mano a ningún lado.
 *
 * Se sigue aceptando `CRON_SECRET` del entorno para no romper lo que ya estaba
 * configurado ni las llamadas manuales que se hacen para probar.
 */

/* Comparación en tiempo constante: comparar con `===` filtra por cuánto tarda
   en fallar, y con eso se puede adivinar el secreto carácter por carácter. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function llamadaDeCronValida(req: Request, db: any): Promise<boolean> {
  const recibido = req.headers.get("x-cron-secret");
  if (!recibido) return false;

  const delEntorno = Deno.env.get("CRON_SECRET");
  if (delEntorno && iguales(delEntorno, recibido)) return true;

  // El de la base es el que usa el cron. Si la consulta falla, se rechaza:
  // ante la duda, no correr es más barato que correr para cualquiera.
  const { data, error } = await db.rpc("secreto_cron");
  if (error || typeof data !== "string" || !data) return false;

  return iguales(data, recibido);
}
