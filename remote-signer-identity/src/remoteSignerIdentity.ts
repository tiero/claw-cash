import { hexDecode, hexEncode } from "./hex.js";
import { Transaction, TxTree } from "@arkade-os/sdk";
import type {
  Identity,
  SignerSession,
  TreeNonces,
  TreePartialSigs,
} from "@arkade-os/sdk";
import { ClwApiClient } from "./apiClient.js";
import { ReadonlyRemoteIdentity } from "./readonlyRemoteIdentity.js";
import { extractDigests, injectSignatures } from "./signingUtils.js";
import type { RemoteSignerConfig } from "./types.js";

/**
 * RemoteSignerSession is a stub SignerSession for RemoteSignerIdentity.
 * MuSig2 collaborative tree signing (used during Ark settlement) requires
 * the private key and is not currently supported via the remote API.
 */
class RemoteSignerSession implements SignerSession {
  getPublicKey(): Promise<Uint8Array> {
    throw new Error("MuSig2 tree signing is not supported by RemoteSignerIdentity");
  }
  init(_tree: TxTree, _scriptRoot: Uint8Array, _rootInputAmount: bigint): Promise<void> {
    throw new Error("MuSig2 tree signing is not supported by RemoteSignerIdentity");
  }
  getNonces(): Promise<TreeNonces> {
    throw new Error("MuSig2 tree signing is not supported by RemoteSignerIdentity");
  }
  aggregatedNonces(_txid: string, _noncesByPubkey: TreeNonces): Promise<{ hasAllNonces: boolean }> {
    throw new Error("MuSig2 tree signing is not supported by RemoteSignerIdentity");
  }
  sign(): Promise<TreePartialSigs> {
    throw new Error("MuSig2 tree signing is not supported by RemoteSignerIdentity");
  }
}

/**
 * RemoteSignerIdentity implements the @arkade-os/sdk Identity interface
 * by delegating all signing operations to the clw.cash API server.
 *
 * Instead of holding a private key locally, it holds only the public key
 * and calls the remote API for each signature.
 */
export class RemoteSignerIdentity implements Identity {
  private readonly apiClient: ClwApiClient;
  private readonly pubKeyBytes: Uint8Array;
  private readonly xOnlyBytes: Uint8Array;

  constructor(config: RemoteSignerConfig) {
    this.pubKeyBytes = hexDecode(config.compressedPublicKey);
    if (this.pubKeyBytes.length !== 33) {
      throw new Error("Expected 33-byte compressed public key (66 hex chars)");
    }
    this.xOnlyBytes = this.pubKeyBytes.slice(1);
    this.apiClient = new ClwApiClient(
      config.apiBaseUrl,
      config.identityId,
      config.sessionToken
    );
  }

  /**
   * Create a new identity on the server and return a configured RemoteSignerIdentity.
   */
  static async create(
    apiBaseUrl: string,
    sessionToken: string
  ): Promise<RemoteSignerIdentity> {
    const identity = await ClwApiClient.createIdentity(apiBaseUrl, sessionToken);
    return new RemoteSignerIdentity({
      apiBaseUrl,
      identityId: identity.id,
      sessionToken,
      compressedPublicKey: identity.public_key,
    });
  }

  // ── ReadonlyIdentity ──────────────────────────────────────

  async xOnlyPublicKey(): Promise<Uint8Array> {
    return this.xOnlyBytes;
  }

  async compressedPublicKey(): Promise<Uint8Array> {
    return this.pubKeyBytes;
  }

  // ── Identity ──────────────────────────────────────────────

  signerSession(): SignerSession {
    return new RemoteSignerSession();
  }

  /**
   * Sign a raw message by delegating to the remote API.
   * Only "schnorr" is supported; "ecdsa" will throw.
   */
  async signMessage(
    message: Uint8Array,
    signatureType: "schnorr" | "ecdsa"
  ): Promise<Uint8Array> {
    if (signatureType === "ecdsa") {
      throw new Error("ECDSA signing is not supported by RemoteSignerIdentity");
    }
    const digestHex = hexEncode(message);
    const sigHex = await this.apiClient.signDigest(digestHex);
    return hexDecode(sigHex);
  }

  /**
   * Sign a PSBT transaction by extracting sighash digests, sending them
   * to the remote API for signing, and injecting the signatures back.
   */
  async sign(tx: Transaction, inputIndexes?: number[]): Promise<Transaction> {
    const digests = extractDigests(tx, this.xOnlyBytes, inputIndexes);
    if (digests.length === 0) {
      return tx;
    }

    const digestHexes = digests.map((d) => ({
      digest: hexEncode(d.digest),
    }));
    const signatureHexes = await this.apiClient.signDigestBatch(digestHexes);

    const results = digests.map((digest, i) => ({
      digest,
      signature: hexDecode(signatureHexes[i]),
    }));

    return injectSignatures(tx, results);
  }

  /**
   * Sign multiple transactions in a single batch (Xverse-like pattern).
   * All transactions are signed atomically — all or nothing.
   */
  async signMultipleTransactions(txs: Transaction[]): Promise<Transaction[]> {
    const allDigests: Array<{
      txIndex: number;
      digest: ReturnType<typeof extractDigests>[number];
    }> = [];

    for (let txIdx = 0; txIdx < txs.length; txIdx++) {
      const digests = extractDigests(txs[txIdx], this.xOnlyBytes);
      for (const digest of digests) {
        allDigests.push({ txIndex: txIdx, digest });
      }
    }

    if (allDigests.length === 0) {
      return txs;
    }

    const digestHexes = allDigests.map((d) => ({
      digest: hexEncode(d.digest.digest),
    }));
    const signatureHexes = await this.apiClient.signDigestBatch(digestHexes);

    const byTx = new Map<number, Array<{ digest: typeof allDigests[0]["digest"]; signature: Uint8Array }>>();
    for (let i = 0; i < allDigests.length; i++) {
      const { txIndex, digest } = allDigests[i];
      if (!byTx.has(txIndex)) byTx.set(txIndex, []);
      byTx.get(txIndex)!.push({
        digest,
        signature: hexDecode(signatureHexes[i]),
      });
    }

    for (const [txIndex, results] of byTx) {
      injectSignatures(txs[txIndex], results);
    }

    return txs;
  }

  /** Convert to a readonly identity (strips signing capability) */
  toReadonly(): ReadonlyRemoteIdentity {
    return new ReadonlyRemoteIdentity(this.pubKeyBytes);
  }

  /** Update the session token */
  setSessionToken(token: string): void {
    this.apiClient.setSessionToken(token);
  }
}
