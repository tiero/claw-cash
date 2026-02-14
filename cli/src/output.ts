export function outputSuccess(data: unknown): never {
  console.log(JSON.stringify({ ok: true, data }, null, 2));
  process.exit(0);
}

export function outputError(error: string, details?: unknown): never {
  console.error(JSON.stringify({ ok: false, error, details }, null, 2));
  process.exit(1);
}
