import { loadConfigWithSources, getSessionStatus } from "../config.js";
import { getPort } from "../daemon.js";
import { outputSuccess } from "../output.js";
import { join } from "node:path";
import { homedir } from "node:os";

export async function handleConfig(): Promise<never> {
  const configWithSources = loadConfigWithSources();
  const session = getSessionStatus(configWithSources.sessionToken.value);

  const apiBaseUrl = configWithSources.apiBaseUrl.value;
  const payBaseUrl = apiBaseUrl.replace("api.", "pay.");

  const result: Record<string, unknown> = {
    apiBaseUrl: { value: apiBaseUrl, source: configWithSources.apiBaseUrl.source },
    payBaseUrl,
    arkServerUrl: { value: configWithSources.arkServerUrl.value, source: configWithSources.arkServerUrl.source },
    network: { value: configWithSources.network.value, source: configWithSources.network.source },
    identityId: { value: configWithSources.identityId.value, source: configWithSources.identityId.source },
    publicKey: { value: configWithSources.publicKey.value, source: configWithSources.publicKey.source },
    daemonPort: getPort(),
    configFile: join(homedir(), ".clw-cash", "config.json"),
    dataDir: join(homedir(), ".clw-cash", "data"),
    session: session.active ? "active" : "expired",
    sessionExpiresAt: session.expiresAt,
  };

  return outputSuccess(result);
}
