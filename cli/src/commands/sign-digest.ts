import { outputSuccess, outputError } from "../output.js";
import { getDaemonUrl, daemonPost } from "../daemonClient.js";
import { loadConfig, validateConfig } from "../config.js";
import { ClwApiClient, ClwApiError } from "@clw-cash/sdk";
import type { ParsedArgs } from "minimist";

/**
 * Normalize a hex digest string.
 * - Strips "0x" prefix if present
 * - Converts to lowercase
 * - Returns null if invalid format
 */
function normalizeDigest(input: string): string | null {
  const cleaned = input.startsWith("0x") ? input.slice(2) : input;
  const lower = cleaned.toLowerCase();
  
  // Validate: exactly 64 hex characters (32 bytes)
  if (!/^[0-9a-f]{64}$/.test(lower)) {
    return null;
  }
  
  return lower;
}

/**
 * Sign a raw 32-byte digest with the wallet's Schnorr key.
 *
 * Usage:
 *   cash sign-digest <hex-digest>
 *   cash sign-digest --hex <hex-digest>
 *   cash sign-digest --digest <hex-digest>
 *
 * Returns a 64-byte Schnorr signature (BIP-340) that can be used for:
 * - Taproot script-path spending (OP_CHECKSIGADD multisig)
 * - Multi-agent multisig coordination
 * - Any BIP-340 Schnorr signing use case
 *
 * The digest should be a BIP-341 sighash for Taproot transactions.
 */
export async function handleSignDigest(_ctx: unknown, args: ParsedArgs): Promise<never> {
  // Get digest from positional arg or named flags
  const digestInput = (args._[1] as string) || (args.hex as string) || (args.digest as string);

  if (!digestInput) {
    return outputError(
      "Missing digest.\n\n" +
      "Usage:\n" +
      "  cash sign-digest <32-byte-hex>\n" +
      "  cash sign-digest --hex <32-byte-hex>\n\n" +
      "Example:\n" +
      "  cash sign-digest e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n\n" +
      "The digest should be 32 bytes (64 hex characters), typically a BIP-341 sighash\n" +
      "for Taproot transaction signing."
    );
  }

  // Normalize and validate digest
  const digest = normalizeDigest(digestInput);
  if (!digest) {
    return outputError(
      `Invalid digest format.\n\n` +
      `Expected: 32 bytes (64 hex characters)\n` +
      `Got: "${digestInput}" (${digestInput.replace(/^0x/, "").length} characters)\n\n` +
      `The digest must be a valid hex string representing exactly 32 bytes.`
    );
  }

  // Try daemon first (if running, it has the context already)
  const daemonUrl = getDaemonUrl();
  if (daemonUrl) {
    try {
      const result = await daemonPost("/sign-digest", { digest });
      return outputSuccess(result);
    } catch (err) {
      // If daemon fails, fall through to direct API call
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("not running")) {
        return outputError(`Daemon error: ${message}`);
      }
    }
  }

  // Direct API call (daemon not running)
  const config = loadConfig();
  const configError = validateConfig(config);
  if (configError) {
    return outputError(configError);
  }

  try {
    const apiClient = new ClwApiClient(
      config.apiBaseUrl,
      config.identityId,
      config.sessionToken
    );

    const signature = await apiClient.signDigest(digest);

    // Validate signature format (should be 64 bytes = 128 hex chars)
    if (!/^[0-9a-f]{128}$/i.test(signature)) {
      return outputError(
        `Unexpected signature format from API.\n` +
        `Expected: 64 bytes (128 hex characters)\n` +
        `Got: ${signature.length} characters`
      );
    }

    return outputSuccess({
      digest,
      signature: signature.toLowerCase(),
      publicKey: config.publicKey,
      signatureFormat: "BIP-340 Schnorr (64 bytes)",
      note: "For Taproot script-path spending, append sighash type byte if not SIGHASH_DEFAULT (0x00).",
    });
  } catch (err) {
    if (err instanceof ClwApiError) {
      return outputError(`API error (${err.statusCode}): ${err.message}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    return outputError(`Signing failed: ${message}`);
  }
}
