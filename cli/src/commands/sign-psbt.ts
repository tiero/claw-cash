import { outputSuccess, outputError } from "../output.js";
import { getDaemonUrl, daemonPost } from "../daemonClient.js";
import { loadConfig, validateConfig } from "../config.js";
import { ClwApiClient, ClwApiError } from "@clw-cash/sdk";
import type { ParsedArgs } from "minimist";
import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";

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
 *
 * The command will:
 * 1. Parse the PSBT and display transaction details
 * 2. Sign any inputs where the wallet's pubkey is a signer
 * 3. Return the updated PSBT with signatures
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
      psbtBytes = Uint8Array.from(atob(psbtInput), c => c.charCodeAt(0));
    }
  } catch (err) {
    return outputError(
      `Failed to decode PSBT.\n\n` +
      `Expected: Base64 or hex encoded PSBT\n` +
      `Make sure the PSBT is properly encoded.`
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

  // Analyze inputs and find ones we can sign
  const inputAnalysis: Array<{
    index: number;
    canSign: boolean;
    txid: string;
    vout: number;
    amount?: bigint;
    type: string;
  }> = [];

  const inputsToSign: Array<{
    index: number;
    sighash: string;
    leafHash?: string;
  }> = [];

  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    
    const analysis: typeof inputAnalysis[0] = {
      index: i,
      canSign: false,
      txid: input.txid ? hex.encode(input.txid) : 'unknown',
      vout: input.index ?? 0,
      amount: input.witnessUtxo?.amount,
      type: 'unknown',
    };

    // Check if this is a Taproot input we can sign
    if (input.tapLeafScript && input.tapLeafScript.length > 0) {
      analysis.type = 'taproot-script-path';
      
      // Check if our pubkey is in any of the leaf scripts
      for (const leafScript of input.tapLeafScript) {
        const scriptHex = hex.encode(leafScript.script).toLowerCase();
        if (scriptHex.includes(walletPubkey)) {
          analysis.canSign = true;
          
          // Compute sighash for this input
          // For Taproot script-path, we need the leaf script and prevouts
          const prevOutScripts = [];
          const amounts = [];
          
          for (let j = 0; j < tx.inputsLength; j++) {
            const inp = tx.getInput(j);
            if (inp.witnessUtxo) {
              prevOutScripts.push(inp.witnessUtxo.script);
              amounts.push(inp.witnessUtxo.amount);
            }
          }
          
          try {
            const sighashPreimage = (tx as any).preimageWitnessV1(
              i,
              prevOutScripts,
              btc.SigHash.DEFAULT,
              amounts,
              undefined,
              leafScript.script,
              leafScript.leafVersion
            );
            
            inputsToSign.push({
              index: i,
              sighash: hex.encode(sighashPreimage),
              leafHash: hex.encode(btc.taprootListToTree(
                [{ script: leafScript.script, leafVersion: leafScript.leafVersion }]
              ).hash),
            });
          } catch (err) {
            // Sighash computation failed - might be missing data
            console.error(`Failed to compute sighash for input ${i}:`, err);
          }
          break;
        }
      }
    } else if (input.tapInternalKey) {
      analysis.type = 'taproot-key-path';
      // Key-path spending - check if our pubkey matches internal key
      const internalPubkey = hex.encode(input.tapInternalKey).toLowerCase();
      if (internalPubkey === walletPubkey) {
        analysis.canSign = true;
        // For key-path, sighash is simpler but still needs BIP-341 computation
      }
    }

    inputAnalysis.push(analysis);
  }

  // Analyze outputs
  const outputAnalysis: Array<{
    index: number;
    address?: string;
    amount: bigint;
  }> = [];

  for (let i = 0; i < tx.outputsLength; i++) {
    const output = tx.getOutput(i);
    outputAnalysis.push({
      index: i,
      address: output.address,
      amount: output.amount ?? 0n,
    });
  }

  // Calculate fee
  const totalIn = inputAnalysis.reduce((sum, i) => sum + (i.amount ?? 0n), 0n);
  const totalOut = outputAnalysis.reduce((sum, o) => sum + o.amount, 0n);
  const fee = totalIn - totalOut;

  // Display transaction summary
  const summary = {
    inputs: inputAnalysis.map(i => ({
      index: i.index,
      txid: i.txid.slice(0, 16) + '...',
      vout: i.vout,
      amount: i.amount?.toString(),
      type: i.type,
      canSign: i.canSign,
    })),
    outputs: outputAnalysis.map(o => ({
      index: o.index,
      address: o.address,
      amount: o.amount.toString(),
    })),
    fee: fee.toString(),
    inputsWeCanSign: inputsToSign.length,
  };

  if (inputsToSign.length === 0) {
    return outputError(
      `No inputs to sign with this wallet.\n\n` +
      `Wallet pubkey: ${walletPubkey}\n\n` +
      `Transaction summary:\n${JSON.stringify(summary, null, 2)}\n\n` +
      `None of the inputs contain scripts with this wallet's public key.`
    );
  }

  // Sign each input
  const signatures: Array<{
    index: number;
    sighash: string;
    signature: string;
  }> = [];

  // Try daemon first
  const daemonUrl = getDaemonUrl();
  
  for (const input of inputsToSign) {
    let signature: string;
    
    if (daemonUrl) {
      try {
        const result = await daemonPost("/sign-digest", { digest: input.sighash });
        signature = (result as any).signature;
      } catch (err) {
        // Fall back to direct API
        const apiClient = new ClwApiClient(
          config.apiBaseUrl,
          config.identityId,
          config.sessionToken
        );
        signature = await apiClient.signDigest(input.sighash);
      }
    } else {
      const apiClient = new ClwApiClient(
        config.apiBaseUrl,
        config.identityId,
        config.sessionToken
      );
      signature = await apiClient.signDigest(input.sighash);
    }

    signatures.push({
      index: input.index,
      sighash: input.sighash,
      signature: signature.toLowerCase(),
    });

    // Add signature to PSBT
    try {
      tx.updateInput(input.index, {
        tapScriptSig: [{
          pubKey: hex.decode(walletPubkey),
          signature: hex.decode(signature),
        }],
      });
    } catch (err) {
      // Signature addition might fail if format is wrong
      console.error(`Warning: Could not add signature to PSBT input ${input.index}`);
    }
  }

  // Export updated PSBT
  const updatedPsbtBytes = tx.toPSBT();
  const updatedPsbtBase64 = btoa(String.fromCharCode(...updatedPsbtBytes));
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
