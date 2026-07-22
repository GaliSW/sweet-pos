import { createServerClient } from "@supabase/ssr";

// e2e 對本地環境打真實 API:
// - dev server:E2E_BASE_URL(預設 http://localhost:3000)
// - 本地 Supabase:E2E_SUPABASE_URL / E2E_SUPABASE_KEY(預設本地 CLI 值)
// - 測試帳號:supabase/seed.sql 的 demo 使用者
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_KEY =
  process.env.E2E_SUPABASE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

export const MANAGER_EMAIL = "manager@example.local";
export const STAFF_A_EMAIL = "staff-a@example.local";
export const PASSWORD = "password123";

// seed.sql 內的固定 id
export const SEED = {
  staffA: "00000000-0000-4000-8000-000000000001", // 林小芸
  staffB: "00000000-0000-4000-8000-000000000002", // 陳柏宇
  staffC: "00000000-0000-4000-8000-000000000003", // 黃品安
  bagOolong: "00000000-0000-4000-8000-000000000101", // 包種烏龍牛軋糖 $280
  bagCranberry: "00000000-0000-4000-8000-000000000102", // 蔓越莓牛軋糖 $280
  bagCracker: "00000000-0000-4000-8000-000000000103", // 經典原味牛軋餅 $320
  smallGiftBox: "00000000-0000-4000-8000-000000000201", // 小禮盒(自選 3)$880
  fortuneGiftBox: "00000000-0000-4000-8000-000000000203", // 發禮盒(固定 4 袋)$980
  flavorOolong: "00000000-0000-4000-8000-000000000501",
  flavorCranberry: "00000000-0000-4000-8000-000000000502",
  flavorStrawberry: "00000000-0000-4000-8000-000000000503",
  flavorMango: "00000000-0000-4000-8000-000000000504"
} as const;

export async function loginCookie(email: string, password: string): Promise<string> {
  const store = new Map<string, string>();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => Array.from(store, ([name, value]) => ({ name, value })),
      setAll: (cookies: Array<{ name: string; value: string }>) =>
        cookies.forEach(({ name, value }) => store.set(name, value))
    }
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(
      `登入失敗(${email}):${error.message}。請確認本地 Supabase 已啟動且 seed 使用者存在。`
    );
  }

  return Array.from(store, ([name, value]) => `${name}=${value}`).join("; ");
}

type ApiResult = { ok: boolean; error?: string; data?: Record<string, unknown> };

export function apiClient(cookie: string) {
  async function request(method: string, path: string, body?: unknown): Promise<ApiResult> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    return (await response.json()) as ApiResult;
  }

  return {
    get: (path: string) => request("GET", path),
    post: (path: string, body: unknown) => request("POST", path, body),
    patch: (path: string, body: unknown) => request("PATCH", path, body),
    put: (path: string, body: unknown) => request("PUT", path, body),
    del: (path: string, body: unknown) => request("DELETE", path, body)
  };
}

export type Api = ReturnType<typeof apiClient>;

export function taipeiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

// 確保 dev server 活著,否則直接給出可行動的錯誤訊息
export async function ensureServer(): Promise<void> {
  try {
    const response = await fetch(`${BASE_URL}/login`, { method: "HEAD" });

    if (!response.ok && response.status !== 405) {
      throw new Error(`status ${response.status}`);
    }
  } catch (cause) {
    throw new Error(
      `無法連線 ${BASE_URL},請先啟動 dev server(npm run dev)與本地 Supabase(npm run db:start)。原因:${String(cause)}`
    );
  }
}
