import { loadConfig, validateConfig } from "../config.js";
import { outputSuccess, outputError } from "../output.js";

export async function handlePubkey(): Promise<never> {
  const config = loadConfig();
  const configError = validateConfig(config);
  if (configError) {
    return outputError(configError);
  }

  if (!config.publicKey) {
    return outputError("Public key not found. Run 'cash init' first.");
  }

  return outputSuccess({ publicKey: config.publicKey });
}
