export type Role = 'viewer' | 'manager';
export function permits(role: Role, required: readonly Role[]): boolean {
  return required.includes(role);
}
