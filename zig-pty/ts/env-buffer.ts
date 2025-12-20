export function encodeEnvBuffer(env?: Record<string, string>): Buffer {
  if (!env) {
    return Buffer.from("\0", "utf8");
  }

  const entries = Object.entries(env);
  if (entries.length === 0) {
    return Buffer.from("\0", "utf8");
  }

  const envPairs = entries.map(([key, value]) => `${key}=${value}`);
  const envStr = envPairs.join("\0") + "\0";
  return Buffer.from(`${envStr}\0`, "utf8");
}
