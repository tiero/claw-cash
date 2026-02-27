import { outputSuccess, outputError } from "../output.js";
import { loadConfig, validateConfig } from "../config.js";
import { ClwApiClient } from "@clw-cash/sdk";
import type { ParsedArgs } from "minimist";
import * as btc from "@scure/btc-signer";
import { tapLeafHash } from "@scure/btc-signer/payment.js";
import { hex, base64 } from "@scure/base";

/**
 * Sign a PSBT (Partially Signed Bitcoin Transaction) with the wallet's Schnorr key.
 *
 * This is the RECOMMENDED way to sign Bitcoin transactions as it:
 * - Parses the PSBT to show what you're signing (no blind signing)
 * - Automatically computes the correct sighash for each input
 * - Returns an updated PSBT with signatures added
 *
 * Usage:
 *   cash sign-psbt <base64-psbt>
 *   cash sign-psbt --psbt <base64-psbt>
 *   cash sign-psbt --hex <hex-psbt>
 */
export async function handleSignPsbt(_ctx: unknown, args: ParsedArgs): Promise<never> {
  // Get PSBT from args
  const psbtInput = (args._[1] as string) || (args.psbt as string) || (args.hex as string);

  if (!psbtInput) {
    return outputError(
      "Missing PSBT.\n\n" +
      "Usage:\n" +
      "  cash sign-psbt <base64-psbt>\n" +
      "  cash sign-psbt --psbt <base64-psbt>\n" +
      "  cash sign-psbt --hex <hex-encoded-psbt>\n\n" +
      "Example:\n" +
      "  cash sign-psbt cHNidP8BAIkCAAAAA...\n\n" +
      "The PSBT should be base64 or hex encoded."
    );
  }

  // Decode PSBT (try base64 first, then hex)
  let psbtBytes: Uint8Array;
  try {
    if (/^[0-9a-fA-F]+$/.test(psbtInput)) {
      // Hex encoded
      psbtBytes = hex.decode(psbtInput);
    } else {
      // Base64 encoded
      psbtBytes = base64.decode(psbtInput);
    }
  } catch {
    return outputError(
      `Failed to decode PSBT.\n\n` +
      `Expected: Base64 or hex encoded PSBT\n` +
      `Make sure the PSBT is properly encoded.`
    );
  }

  // Verify PSBT magic bytes
  const PSBT_MAGIC = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff]); // "psbt" + 0xff
  if (psbtBytes.length < 5 || !PSBT_MAGIC.every((b, i) => psbtBytes[i] === b)) {
    return outputError(
      `Invalid PSBT format.\n\n` +
      `The data does not have valid PSBT magic bytes.\n` +
      `Expected: 70736274ff (psbt + 0xff)`
    );
  }

  // Parse PSBT
  let tx: btc.Transaction;
  try {
    tx = btc.Transaction.fromPSBT(psbtBytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return outputError(`Failed to parse PSBT: ${message}`);
  }

  // Get wallet config to know our pubkey
  const config = loadConfig();
  const configError = validateConfig(config);
  if (configError) {
    return outputError(configError);
  }

  const walletPubkey = config.publicKey?.toLowerCase();
  if (!walletPubkey) {
    return outputError("Wallet public key not configured.");
  }

  // Analyze inputs
  const inputAnalysis: Array<{
    index: number;
    canSign: boolean;
    txid: string;
    vout: number;
    amount?: string;
    type: string;
  }> = [];

  const inputsToSign: Array<{
    index: number;
    sighash: string;
    leafHash?: string;
    script?: Uint8Array;
  }> = [];

  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    
    const analysis: (typeof inputAnalysis)[0] = {
      index: i,
      canSign: false,
      txid: input.txid ? hex.encode(input.txid) : 'unknown',
      vout: input.index ?? 0,
      amount: input.witnessUtxo?.amount?.toString(),
      type: 'unknown',
    };

    // Check if this is a Taproot input we can sign
    // tapLeafScript is array of [controlBlock, script] tuples
    if (input.tapLeafScript && input.tapLeafScript.length > 0) {
      analysis.type = 'taproot-script-path';
      
      // Check if our pubkey is in any of the leaf scripts
      for (const leafEntry of input.tapLeafScript) {
        // leafEntry is [controlBlock, script] tuple
        const [controlBlock, script] = leafEntry;
        if (!script) continue;

        // Check if our pubkey appears in the script as a proper push (0x20 prefix for 32-byte push)
        const walletPubkeyBytes = hex.decode(walletPubkey);
        let foundPubkey = false;

        // Look for 0x20 (OP_PUSHBYTES_32) followed by our pubkey
        for (let pos = 0; pos < script.length - 32; pos++) {
          if (script[pos] === 0x20) {
            const pushedData = script.slice(pos + 1, pos + 33);
            if (pushedData.every((byte, idx) => byte === walletPubkeyBytes[idx])) {
              foundPubkey = true;
              break;
            }
          }
        }

        if (foundPubkey) {
          analysis.canSign = true;
          
          // Compute sighash for this input using btc-signer's built-in method
          try {
            // Get prevout data for all inputs
            const prevOutScripts: Uint8Array[] = [];
            const amounts: bigint[] = [];
            
            for (let j = 0; j < tx.inputsLength; j++) {
              const inp = tx.getInput(j);
              if (inp.witnessUtxo) {
                prevOutScripts.push(inp.witnessUtxo.script);
                amounts.push(inp.witnessUtxo.amount);
              }
            }
            
            // Get leaf version from control block (first byte has version info)
            const leafVersion = controlBlock.version ?? 0xc0;
            
            // Use the transaction's preimage method if available
            // Otherwise fall back to manual computation
            const txAny = tx as any;
            if (typeof txAny.preimageWitnessV1 === 'function') {
              const sighashBytes = txAny.preimageWitnessV1(
                i,
                prevOutScripts,
                btc.SigHash.DEFAULT,
                amounts,
                undefined,
                script,
                leafVersion & 0xfe // Strip the parity bit
              );
              
              // Compute leaf hash for tapScriptSig
              const leafHash = tapLeafHash(script, leafVersion & 0xfe);
              
              inputsToSign.push({
                index: i,
                sighash: hex.encode(sighashBytes),
                leafHash: hex.encode(leafHash),
                script: script,
              });
            }
          } catch (err) {
            console.error(`Failed to compute sighash for input ${i}:`, err);
          }
          break;
        }
      }
    } else if (input.tapInternalKey) {
      analysis.type = 'taproot-key-path';
      const internalPubkey = hex.encode(input.tapInternalKey).toLowerCase();
      if (internalPubkey === walletPubkey) {
        analysis.canSign = true;
      }
    }

    inputAnalysis.push(analysis);
  }

  // Analyze outputs
  const outputAnalysis: Array<{
    index: number;
    amount: string;
  }> = [];

  for (let i = 0; i < tx.outputsLength; i++) {
    const output = tx.getOutput(i);
    outputAnalysis.push({
      index: i,
      amount: (output.amount ?? 0n).toString(),
    });
  }

  // Calculate fee
  const totalIn = inputAnalysis.reduce((sum, i) => sum + BigInt(i.amount ?? 0), 0n);
  const totalOut = outputAnalysis.reduce((sum, o) => sum + BigInt(o.amount), 0n);
  const fee = totalIn - totalOut;

  const summary = {
    inputs: inputAnalysis.map(i => ({
      index: i.index,
      txid: i.txid.slice(0, 16) + '...',
      vout: i.vout,
      amount: i.amount,
      type: i.type,
      canSign: i.canSign,
    })),
    outputs: outputAnalysis.map(o => ({
      index: o.index,
      amount: o.amount,
    })),
    fee: fee.toString(),
    inputsWeCanSign: inputsToSign.length,
  };

  // Check if we found key-path inputs that we can't sign yet
  const keyPathInputsWithOurKey = inputAnalysis.filter(
    i => i.type === 'taproot-key-path' && i.canSign
  );

  if (inputsToSign.length === 0) {
    if (keyPathInputsWithOurKey.length > 0) {
      return outputError(
        `Cannot sign Taproot key-path inputs (not yet implemented).\n\n` +
        `Wallet pubkey: ${walletPubkey}\n\n` +
        `Found ${keyPathInputsWithOurKey.length} Taproot key-path input(s) with this wallet's internal key, ` +
        `but key-path signing is not implemented yet.\n\n` +
        `Currently only Taproot script-path signing is supported.\n\n` +
        `Transaction summary:\n${JSON.stringify(summary, null, 2)}`
      );
    }

    return outputError(
      `No inputs to sign with this wallet.\n\n` +
      `Wallet pubkey: ${walletPubkey}\n\n` +
      `Transaction summary:\n${JSON.stringify(summary, null, 2)}\n\n` +
      `None of the inputs contain scripts with this wallet's public key.`
    );
  }

  // Sign each input via API (enclave)
  const signatures: Array<{
    index: number;
    sighash: string;
    signature: string;
  }> = [];

  const apiClient = new ClwApiClient(
    config.apiBaseUrl,
    config.identityId,
    config.sessionToken
  );

  for (const input of inputsToSign) {
    const signature = await apiClient.signDigest(input.sighash);

    signatures.push({
      index: input.index,
      sighash: input.sighash,
      signature: signature.toLowerCase(),
    });

    // Add signature to PSBT using tapScriptSig
    if (input.leafHash) {
      try {
        const pubKeyBytes = hex.decode(walletPubkey);
        const leafHashBytes = hex.decode(input.leafHash);
        const sigBytes = hex.decode(signature);

        tx.updateInput(input.index, {
          tapScriptSig: [[{ pubKey: pubKeyBytes, leafHash: leafHashBytes }, sigBytes]],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return outputError(
          `Failed to add signature to PSBT input ${input.index}.\n\n` +
          `Error: ${message}\n\n` +
          `The signature was created successfully, but could not be added to the PSBT. ` +
          `This may indicate an incompatible PSBT structure.`
        );
      }
    }
  }

  // Export updated PSBT
  const updatedPsbtBytes = tx.toPSBT();
  const updatedPsbtBase64 = base64.encode(updatedPsbtBytes);
  const updatedPsbtHex = hex.encode(updatedPsbtBytes);

  return outputSuccess({
    summary: {
      inputsTotal: inputAnalysis.length,
      outputsTotal: outputAnalysis.length,
      fee: fee.toString() + ' sats',
      inputsSigned: signatures.length,
    },
    signatures: signatures.map(s => ({
      inputIndex: s.index,
      signature: s.signature,
    })),
    psbt: {
      base64: updatedPsbtBase64,
      hex: updatedPsbtHex,
    },
    publicKey: walletPubkey,
    note: "PSBT updated with signatures. Pass to other signers or finalize if threshold met.",
  });
}
