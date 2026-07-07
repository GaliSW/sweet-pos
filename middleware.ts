import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // API 路由也要經過 middleware 以刷新過期的 access token,
  // 但驗證失敗時交給各 route 回 401 JSON,不做頁面轉導。
  const isApi = pathname.startsWith("/api");

  if (pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return isApi ? NextResponse.next() : demoModeMiddleware(request, pathname);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (isApi) {
    return response;
  }

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/manager")) {
    const role = await fetchUserRole(supabaseUrl, serviceRoleKey, user.id);

    if (role !== "manager") {
      return NextResponse.redirect(new URL("/pos", request.url));
    }
  }

  return response;
}

function demoModeMiddleware(request: NextRequest, pathname: string) {
  const role = request.cookies.get("pos-cloud-role")?.value;

  if (!role) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/manager") && role !== "manager") {
    return NextResponse.redirect(new URL("/pos", request.url));
  }

  return NextResponse.next();
}

async function fetchUserRole(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&is_active=eq.true&select=role`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );
    const rows = (await response.json()) as Array<{ role?: string }>;

    return Array.isArray(rows) ? rows[0]?.role ?? null : null;
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
