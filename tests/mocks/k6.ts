// tests/mocks/k6.ts
export function check(val: any, sets: Record<string, (v: any) => boolean>): boolean {
  return true;
}

export function sleep(seconds: number): void {}
