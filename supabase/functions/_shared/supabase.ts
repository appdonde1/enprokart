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

export type StaffRole = "admin" | "mesero";

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
