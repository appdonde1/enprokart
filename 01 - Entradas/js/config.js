/* Configuración pública del proyecto Supabase.
   La anon key está pensada para vivir en el navegador: lo que protege los datos
   son las políticas RLS, no ocultar esta clave. La service_role key, en cambio,
   NUNCA va acá: vive solo como secreto de las Edge Functions. */

window.PROKART_CONFIG = {
  SUPABASE_URL: "https://tgilgfwxtghcqskfyzif.supabase.co",

  SUPABASE_ANON_KEY: "sb_publishable_2qZJfoQJi-R3UxVPvtO6zw_ztu8Z2_N",

  EVENT_SLUG: "noche-vip-fest",
};
