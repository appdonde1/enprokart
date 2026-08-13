import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Cliente con el token del usuario: sirve para resolver quién llama sin confiar
// en nada que venga en el cuerpo del request.
export function userClient(authHeader: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    },
  );
}

export type StaffRole = "developer" | "admin" | "mesero";

export const ROLES: StaffRole[] = ["developer", "admin", "mesero"];

export function esRol(valor: unknown): valor is StaffRole {
  return ROLES.includes(valor as StaffRole);
}

/* `developer` puede todo lo que puede un admin: es la misma llave que abre las
   políticas de la base, donde `is_admin()` cuenta a los dos. La diferencia entre
   ambos es a quién pueden gestionar, no qué pueden ver. */
export function esAdmin(rol: StaffRole): boolean {
  return rol === "admin" || rol === "developer";
}

/* Quién puede gestionar a quién.

   Un admin gestiona meseros y empleados. Entre administradores no hay ninguna
   acción disponible: no pueden crearse, editarse, degradarse ni eliminarse unos
   a otros, ni tocar la cuenta de desarrollo. Eso lo hace solo el developer.

   La regla vive acá y no repartida por cada función, para que no terminen
   existiendo dos versiones que digan cosas distintas. */
export function puedeActuarSobre(actor: StaffRole, objetivo: StaffRole): boolean {
  if (actor === "developer") return true;
  if (actor === "admin") return objetivo === "mesero";
  return false;
}

export async function requireStaff(
  req: Request,
): Promise<{ userId: string; role: StaffRole } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const { data: userData } = await userClient(authHeader).auth.getUser();
  if (!userData?.user) return null;

  const { data: profile } = await serviceClient()
    .from("staff_profiles")
    .select("id, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile) return null;
  return { userId: profile.id, role: profile.role as StaffRole };
}
