import { ClwApiClient } from "@clw-cash/sdk";
import { loadConfig, saveConfig, getSessionStatus, type CashConfig } from "../config.js";
import { outputSuccess } from "../output.js";
import { getPort, startDaemonInBackground } from "../daemon.js";
import type { ParsedArgs } from "minimist";

async function authenticate(config: CashConfig): Promise<string> {
  const challengeRes = await fetch(`${config.apiBaseUrl}/v1/auth/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!challengeRes.ok) {
    throw new Error(`Challenge failed: ${await challengeRes.text()}`);
  }

  const challenge = (await challengeRes.json()) as {
    challenge_id: string;
    deep_link: string | null;
  };

  if (challenge.deep_link) {
    console.error(`Open this link to authenticate:\n\n  ${challenge.deep_link}\n`);
    console.error("Waiting for confirmation...");
  }

  // Poll verify until resolved (120s timeout)
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const verifyRes = await fetch(`${config.apiBaseUrl}/v1/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge_id: challenge.challenge_id }),
    });

    if (verifyRes.ok) {
      const session = (await verifyRes.json()) as {
        token: string;
        expires_in: number;
      };
      return session.token;
    }

    if (verifyRes.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    throw new Error(`Verify failed: ${await verifyRes.text()}`);
  }

  throw new Error("Login timed out");
}

async function restoreIdentity(config: CashConfig): Promise<void> {
  const res = await fetch(`${config.apiBaseUrl}/v1/identities/${config.identityId}/restore`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.sessionToken}`,
    },
    body: JSON.stringify({ public_key: config.publicKey }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to restore identity: ${text}`);
  }
}

export async function handleInit(args: ParsedArgs): Promise<never> {
  const config = loadConfig({
    apiBaseUrl: args["api-url"] as string | undefined,
    sessionToken: args.token as string | undefined,
    arkServerUrl: args["ark-server"] as string | undefined,
    network: args.network as string | undefined,
  });

  // Auto-login if no token or token expired
  if (!config.sessionToken || !getSessionStatus(config.sessionToken).active) {
    config.sessionToken = await authenticate(config);
  }

  if (!config.identityId || !config.publicKey) {
    // No identity yet — create a new one
    const identity = await ClwApiClient.createIdentity(
      config.apiBaseUrl,
      config.sessionToken
    );
    config.identityId = identity.id;
    config.publicKey = identity.public_key;
  } else {
    // Identity exists in config — ensure it's registered on the API (survives server restarts)
    await restoreIdentity(config);
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
