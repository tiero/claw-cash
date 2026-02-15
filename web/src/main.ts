import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { parseParams } from "./params.js";
import { connectWallet } from "./wallet.js";
import { createSwap, getFundingCallData, pollSwapStatus } from "./swap.js";
import { renderPage, setStep, setStatus, setEnsName, setSender, showError } from "./ui.js";
import "./style.css";

async function main() {
  try {
    // Show loading while fetching swap data (for short URLs)
    setStep("loading");
    const params = await parseParams();
    renderPage(params);

    // If swap is already funded/completed/expired, show status and stop
    if (params.status !== "pending" && params.status !== "awaiting_funding") {
      const FUNDED = new Set([
        "clientfundingseen", "clientfunded", "serverfunded", "processing",
        "clientredeemed", "serverredeemed", "clientredeemedandclientrefunded", "completed",
      ]);
      const EXPIRED = new Set(["expired", "clientfundedtoolate", "failed"]);
      const REFUNDED = new Set(["clientrefunded", "clientfundedserverrefunded", "clientrefundedserverfunded", "clientrefundedserverrefunded"]);

      if (FUNDED.has(params.status)) {
        setStep("already-paid");
      } else if (EXPIRED.has(params.status) || REFUNDED.has(params.status)) {
        setStep("link-expired");
      } else {
        setStep("link-expired");
      }
      return;
    }

    // Background ENS reverse lookup (non-blocking)
    if (params.to.startsWith("0x")) {
      const ensClient = createPublicClient({ chain: mainnet, transport: http() });
      ensClient
        .getEnsName({ address: params.to as `0x${string}` })
        .then((name) => {
          if (name) setEnsName(name);
        })
        .catch(() => {
          /* ENS resolution is best-effort */
        });
    }

    document.getElementById("connect-btn")!.addEventListener("click", async () => {
      try {
        // 1. Connect wallet
        setStep("connecting");
        const { walletClient, publicClient, address } = await connectWallet(params.chain);
        setSender(address);

        let approveTo: string;
        let approveData: string;
        let fundTo: string;
        let fundData: string;
        let swapId: string | undefined;

        if (params.funding) {
          // Pre-created by CLI — funding call data from API or URL
          approveTo = params.funding.approveTo;
          approveData = params.funding.approveData;
          fundTo = params.funding.fundTo;
          fundData = params.funding.fundData;
          swapId = params.swapId;
        } else {
          // Legacy flow: web creates the swap and fetches call data
          setStep("creating-swap");
          const swapResult = await createSwap(params, address);
          swapId = swapResult.response.id;

          setStep("preparing-tx");
          const callData = await getFundingCallData(swapId, params.token);
          approveTo = callData.approve.to;
          approveData = callData.approve.data;
          fundTo = callData.createSwap.to;
          fundData = callData.createSwap.data;
        }

        // 2. Approve token spend
        setStep("approve");
        const approveTxHash = await walletClient.sendTransaction({
          to: approveTo as `0x${string}`,
          data: approveData as `0x${string}`,
          account: address,
          chain: walletClient.chain,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

        // 3. Fund the swap
        setStep("fund");
        const fundTxHash = await walletClient.sendTransaction({
          to: fundTo as `0x${string}`,
          data: fundData as `0x${string}`,
          account: address,
          chain: walletClient.chain,
        });
        await publicClient.waitForTransactionReceipt({ hash: fundTxHash });

        // 4. Done — CLI daemon handles claiming
        if (params.funding) {
          // Pre-created swap: no need to poll API, the CLI daemon claims automatically
          setStep("done");
        } else if (swapId) {
          // Legacy: poll LendaSwap API for completion
          setStep("waiting");
          const success = await pollSwapStatus(swapId, (status) => {
            setStatus(status);
          });
          setStep(success ? "done" : "failed");
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  } catch (err) {
    showError(err instanceof Error ? err.message : "Invalid payment link");
  }
}

main();
