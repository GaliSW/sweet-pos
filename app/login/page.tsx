import { LoginForm } from "@/components/shared/LoginForm";
import { RoleLogin } from "@/components/shared/RoleLogin";

const hasAuthEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <span className="brand-mark">PC</span>
        <h1>POS Cloud</h1>
        {hasAuthEnv ? (
          <>
            <p>使用員工帳號登入。一般員工進入前台，店長可進入店長後台。</p>
            <LoginForm />
          </>
        ) : (
          <>
            <p>尚未設定 Supabase 環境變數，以示範角色進入工作區。</p>
            <RoleLogin />
          </>
        )}
      </section>
    </main>
  );
}
