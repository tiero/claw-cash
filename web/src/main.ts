import { parseParams } from "./params.js";
import { connectWallet } from "./wallet.js";
import { createSwap, getFundingCallData, pollSwapStatus } from "./swap.js";
import { renderPage, setStep, setStatus, showError } from "./ui.js";
import "./style.css";

async function main() {
  try {
    const params = parseParams();
    renderPage(params);

    document.getElementById("connect-btn")!.addEventListener("click", async () => {
      try {
        // 1. Connect wallet
        setStep("connecting");
        const { walletClient, publicClient, address } = await connectWallet(params.chain);

        // 2. Create swap via LendaSwap
        setStep("creating-swap");
        const swapResult = await createSwap(params, address);
        const swapId = swapResult.response.id;

        // 3. Get funding calldata
        setStep("preparing-tx");
        const callData = await getFundingCallData(swapId, params.token);

        // 4. Approve token spend
        setStep("approve");
        const approveTxHash = await walletClient.sendTransaction({
          to: callData.approve.to as `0x${string}`,
          data: callData.approve.data as `0x${string}`,
          account: address,
          chain: walletClient.chain,
        });

        // Wait for approve confirmation before funding
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

        // 5. Fund the swap
        setStep("fund");
        const fundTxHash = await walletClient.sendTransaction({
          to: callData.createSwap.to as `0x${string}`,
          data: callData.createSwap.data as `0x${string}`,
          account: address,
          chain: walletClient.chain,
        });

        await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

        // 6. Poll for completion
        setStep("waiting");
        const success = await pollSwapStatus(swapId, (status, isSuccess) => {
          setStatus(status);
        });

        setStep(success ? "done" : "failed");
      } catch (err) {
        showError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  } catch (err) {
    showError(err instanceof Error ? err.message : "Invalid payment link");
  }
}

main();
