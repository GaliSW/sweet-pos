import { NextResponse } from "next/server";
import { getSessionProfile, hasAuthEnv, type SessionProfile } from "@/lib/auth/session";

export type GuardResult =
  | { profile: SessionProfile | null; failure?: undefined }
  | { profile?: undefined; failure: NextResponse };

export async function requireRole(role?: "manager"): Promise<GuardResult> {
  if (!hasAuthEnv()) {
    return { profile: null };
  }

  const profile = await getSessionProfile();

  if (!profile) {
    return {
      failure: NextResponse.json(
        { ok: false, error: "登入已失效，請重新整理頁面後重新登入" },
        { status: 401 }
      )
    };
  }

  if (role === "manager" && profile.role !== "manager") {
    return {
      failure: NextResponse.json({ ok: false, error: "需要店長權限" }, { status: 403 })
    };
  }

  return { profile };
}
