import { ClwApiClient } from "@clw-cash/sdk";
import { loadConfig, saveConfig, type CashConfig } from "../config.js";
import { outputSuccess, outputError } from "../output.js";
import { getPort, startDaemonInBackground } from "../daemon.js";
import type { ParsedArgs } from "minimist";

export async function handleInit(args: ParsedArgs): Promise<never> {
  const config = loadConfig({
    apiBaseUrl: args["api-url"] as string | undefined,
    sessionToken: args.token as string | undefined,
    arkServerUrl: args["ark-server"] as string | undefined,
    network: args.network as string | undefined,
  });

  if (!config.apiBaseUrl) {
    return outputError("Missing --api-url <url>");
  }
  if (!config.sessionToken) {
    return outputError("Missing --token <jwt>");
  }
  if (!config.arkServerUrl) {
    return outputError("Missing --ark-server <url>");
  }

  // Create a new identity if none specified
  if (!config.identityId || !config.publicKey) {
    const identity = await ClwApiClient.createIdentity(
      config.apiBaseUrl,
      config.sessionToken
    );
    config.identityId = identity.id;
    config.publicKey = identity.public_key;
  }

  saveConfig(config);

  // Auto-start the daemon for swap monitoring
  let daemon: { pid: number; port: number } | null = null;
  try {
    const port = getPort();
    const { pid } = await startDaemonInBackground(port);
    daemon = { pid, port };
  } catch {
    // Non-fatal — daemon can be started manually with `cash start`
  }

  return outputSuccess({
    message: "Config saved to ~/.clw-cash/config.json",
    identityId: config.identityId,
    publicKey: config.publicKey,
    network: config.network,
    daemon,
  });
}
