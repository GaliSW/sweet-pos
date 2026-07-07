import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/db/server";

export type SessionProfile = {
  id: string;
  displayName: string;
  role: "staff" | "manager";
};

export function hasAuthEnv() {
  return (
    hasSupabaseAdminEnv() && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  );
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  if (!hasAuthEnv()) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {}
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, display_name, role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  return {
    id: profile.id,
    displayName: profile.display_name,
    role: profile.role as "staff" | "manager"
  };
}
