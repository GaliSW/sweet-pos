export const COUNTER_COOKIE = "pos-counter-id";
export const COUNTER_CHANGED_EVENT = "pos-counter-changed";

export function getSelectedCounterId() {
  if (typeof document === "undefined") return "";

  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${COUNTER_COOKIE}=`));

  return match ? decodeURIComponent(match.split("=")[1] ?? "") : "";
}

export function setSelectedCounterId(counterId: string) {
  document.cookie = `${COUNTER_COOKIE}=${encodeURIComponent(counterId)}; path=/; max-age=31536000; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(COUNTER_CHANGED_EVENT, { detail: counterId }));
}
