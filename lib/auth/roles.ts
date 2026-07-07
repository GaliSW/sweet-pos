export type UserRole = "staff" | "manager";

export function canAccessPath(role: UserRole, pathname: string) {
  if (pathname.startsWith("/manager")) {
    return role === "manager";
  }

  return true;
}
