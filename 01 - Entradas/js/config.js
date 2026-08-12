/* Configuración pública del proyecto Supabase.
   La anon key está pensada para vivir en el navegador: lo que protege los datos
   son las políticas RLS, no ocultar esta clave. La service_role key, en cambio,
   NUNCA va acá: vive solo como secreto de las Edge Functions. */

window.PROKART_CONFIG = {
  SUPABASE_URL: "https://tgilgfwxtghcqskfyzif.supabase.co",

  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnaWxnZnd4dGdoY3Fza2Z5emlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODk5NjYsImV4cCI6MjEwMjA2NTk2Nn0.yzxMEEw8QezoKrJnNltue5bpcueTJUL2jB1T9Kvz2Kw",

  EVENT_SLUG: "noche-vip-fest",
};
