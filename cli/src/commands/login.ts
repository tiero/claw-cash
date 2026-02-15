import { loadConfig, saveConfig } from "../config.js";
import { outputSuccess, outputError } from "../output.js";
import { getDaemonStatus, stopDaemon, startDaemonInBackground, getPort } from "../daemon.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

export async function handleLogin(): Promise<never> {
  const config = loadConfig();

  if (!config.apiBaseUrl) {
    return outputError("Not initialized. Run 'cash init' first.");
  }

  // Step 1: Request a challenge
  const challengeRes = await fetch(`${config.apiBaseUrl}/v1/auth/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!challengeRes.ok) {
    const text = await challengeRes.text();
    return outputError(`Challenge request failed: ${text}`);
  }

  const challenge = (await challengeRes.json()) as {
    challenge_id: string;
    expires_at: string;
    deep_link: string | null;
  };

  if (challenge.deep_link) {
    console.error(`Open this link to authenticate:\n\n  ${challenge.deep_link}\n`);
    console.error("Waiting for confirmation...");
  } else {
    console.error(`Challenge ID: ${challenge.challenge_id}`);
    console.error("Waiting for confirmation (test mode)...");
  }

  // Step 2: Poll verify until resolved or timeout
  const deadline = Date.now() + POLL_TIMEOUT_MS;

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
        user: { id: string; telegram_user_id: string; status: string };
      };

      config.sessionToken = session.token;
      saveConfig(config);

      // If identity exists in config, restore it on the API
      if (config.identityId && config.publicKey) {
        const restoreRes = await fetch(
          `${config.apiBaseUrl}/v1/identities/${config.identityId}/restore`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify({ public_key: config.publicKey }),
          }
        );
        if (!restoreRes.ok) {
          const text = await restoreRes.text();
          console.error(`Warning: identity restore failed: ${text}`);
        }
      }

      // Restart daemon if it was running (so it picks up the new token)
      const daemonStatus = getDaemonStatus();
      let daemon: { restarted: boolean; pid?: number; port?: number } = { restarted: false };
      if (daemonStatus.running) {
        console.error("Restarting daemon with new session...");
        await stopDaemon();
        try {
          const port = getPort();
          const { pid } = await startDaemonInBackground(port);
          daemon = { restarted: true, pid, port };
        } catch (err) {
          console.error(`Warning: daemon restart failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      return outputSuccess({
        message: "Logged in successfully",
        userId: session.user.id,
        expiresIn: session.expires_in,
        daemon,
      });
    }

    // 202 = not yet resolved, keep polling
    if (verifyRes.status === 202) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    const text = await verifyRes.text();
    return outputError(`Verify failed: ${text}`);
  }

  return outputError("Login timed out. Please try again.");
}
