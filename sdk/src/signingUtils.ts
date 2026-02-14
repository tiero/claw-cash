import { Transaction } from "@arkade-os/sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import type { InputDigest } from "./types.js";

/**
 * BIP 340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg)
 */
function taggedHash(tag: string, ...msgs: Uint8Array[]): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  let totalLen = tagHash.length * 2;
  for (const m of msgs) totalLen += m.length;
  const buf = new Uint8Array(totalLen);
  buf.set(tagHash, 0);
  buf.set(tagHash, tagHash.length);
  let offset = tagHash.length * 2;
  for (const m of msgs) {
    buf.set(m, offset);
    offset += m.length;
  }
  return sha256(buf);
}

/**
 * Bitcoin CompactSize (varint) encoding for script length prefix.
 */
function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
  if (n <= 0xffffffff)
    return new Uint8Array([
      0xfe,
      n & 0xff,
      (n >> 8) & 0xff,
      (n >> 16) & 0xff,
      (n >> 24) & 0xff,
    ]);
  throw new Error("compactSize: value too large");
}

/**
 * Compute BIP 341 tap leaf hash: taggedHash("TapLeaf", version || compactSize(len) || script)
 */
function tapLeafHash(
  script: Uint8Array,
  version: number = 0xc0
): Uint8Array {
  return taggedHash(
    "TapLeaf",
    new Uint8Array([version]),
    compactSize(script.length),
    script
  );
}

/**
 * Get previous output (script + amount) from a PSBT input.
 * Mirrors @scure/btc-signer's getPrevOut().
 */
function getPrevOut(input: ReturnType<Transaction["getInput"]>): {
  script: Uint8Array;
  amount: bigint;
} {
  if (input.nonWitnessUtxo && input.index !== undefined) {
    return input.nonWitnessUtxo.outputs[input.index];
  }
  if (input.witnessUtxo) return input.witnessUtxo;
  throw new Error("Cannot find previous output info");
}

/**
 * Extract sighash digests from a PSBT for all taproot inputs matching our pubkey.
 *
 * This replicates the digest-computation part of Transaction.signIdx() without
 * the actual signing step, so we can delegate signing to a remote server.
 */
export function extractDigests(
  tx: Transaction,
  xOnlyPubKey: Uint8Array,
  inputIndexes?: number[]
): InputDigest[] {
  const digests: InputDigest[] = [];
  const indexes =
    inputIndexes ?? Array.from({ length: tx.inputsLength }, (_, i) => i);

  // Collect prevOutScript and amount arrays for ALL inputs (required by BIP 341)
  const prevOutScripts: Uint8Array[] = [];
  const amounts: bigint[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    try {
      const prevOut = getPrevOut(inp);
      prevOutScripts.push(prevOut.script);
      amounts.push(prevOut.amount);
    } catch {
      // Input without prevout info — push placeholders
      prevOutScripts.push(new Uint8Array(0));
      amounts.push(0n);
    }
  }

  for (const idx of indexes) {
    const input = tx.getInput(idx);
    if (!input) continue;

    const sighash = input.sighashType ?? 0x00; // DEFAULT for taproot

    // Taproot key-path: tapInternalKey matches our x-only pubkey
    if (input.tapInternalKey && bytesEqual(input.tapInternalKey, xOnlyPubKey)) {
      try {
        const preimage = tx.preimageWitnessV1(
          idx,
          prevOutScripts,
          sighash,
          amounts
        );
        digests.push({
          inputIndex: idx,
          digest: preimage,
          signatureType: "schnorr",
          isTapKeyPath: true,
        });
        continue;
      } catch {
        // Could not compute preimage for this input, skip
      }
    }

    // Taproot leaf-script: tapLeafScript contains our pubkey
    if (input.tapLeafScript) {
      for (const [, leafBytes] of input.tapLeafScript) {
        // leafBytes is raw Uint8Array: script bytes + version byte appended at end
        const script = leafBytes.subarray(0, -1);
        const ver = leafBytes[leafBytes.length - 1];

        if (script.length > 0 && containsPubKey(script, xOnlyPubKey)) {
          try {
            const preimage = tx.preimageWitnessV1(
              idx,
              prevOutScripts,
              sighash,
              amounts,
              undefined, // codeSeparator
              script, // actual leaf script bytes
              ver // leaf version
            );
            const leafHash = tapLeafHash(script, ver);
            digests.push({
              inputIndex: idx,
              digest: preimage,
              signatureType: "schnorr",
              isTapKeyPath: false,
              leafHash,
              signerPubKey: xOnlyPubKey,
            });
          } catch {
            // Could not compute preimage for this leaf, skip
          }
        }
      }
    }
  }

  return digests;
}

/**
 * Inject Schnorr signatures back into a Transaction's PSBT inputs.
 */
export function injectSignatures(
  tx: Transaction,
  results: Array<{ digest: InputDigest; signature: Uint8Array }>
): Transaction {
  for (const { digest, signature } of results) {
    const idx = digest.inputIndex;

    if (digest.isTapKeyPath) {
      const sighash = tx.getInput(idx)?.sighashType ?? 0x00;
      const sig =
        sighash === 0x00
          ? signature
          : Uint8Array.from([...signature, sighash]);
      tx.updateInput(idx, { tapKeySig: sig });
    } else if (digest.leafHash) {
      const input = tx.getInput(idx);
      const sighash = input?.sighashType ?? 0x00;
      const sig =
        sighash === 0x00
          ? signature
          : Uint8Array.from([...signature, sighash]);

      const pubkey = digest.signerPubKey;
      if (pubkey) {
        tx.updateInput(idx, {
          tapScriptSig: [
            [{ pubKey: pubkey, leafHash: digest.leafHash }, sig],
          ],
        });
      }
    }
  }

  return tx;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function containsPubKey(script: Uint8Array, pubKey: Uint8Array): boolean {
  if (script.length < pubKey.length) return false;
  for (let i = 0; i <= script.length - pubKey.length; i++) {
    let match = true;
    for (let j = 0; j < pubKey.length; j++) {
      if (script[i + j] !== pubKey[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}
