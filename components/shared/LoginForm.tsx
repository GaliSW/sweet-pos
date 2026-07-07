"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/db/supabase";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (signInError) {
      setError("帳號或密碼錯誤");
      setPending(false);
      return;
    }

    const response = await fetch("/api/me");
    const result = await response.json();

    if (!result.ok) {
      setError(result.error ?? "無法取得帳號資料，請聯絡店長");
      await supabase.auth.signOut();
      setPending(false);
      return;
    }

    window.location.assign(result.data.role === "manager" ? "/manager" : "/pos");
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="field">
        <span>Email</span>
        <input
          autoComplete="username"
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="field">
        <span>密碼</span>
        <input
          autoComplete="current-password"
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error ? <p className="login-error">{error}</p> : null}
      <button className="primary-action" disabled={pending} type="submit">
        {pending ? "登入中..." : "登入"}
      </button>
    </form>
  );
}
