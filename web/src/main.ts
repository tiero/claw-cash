import { createPublicClient, http, erc20Abi, parseUnits } from "viem";
import { mainnet } from "viem/chains";
import { parseParams, CURRENCY_CHAIN_TO_TOKEN, TOKEN_DECIMALS } from "./params.js";
import { connectWallet } from "./wallet.js";
import { createSwap, getFundingCallData, pollSwapStatus } from "./swap.js";
import { renderPage, setStep, setStatus, setEnsName, setSender, selectChain, showError, updateDebug } from "./ui.js";
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

    // Chain selection: sender picks which chain to pay on
    let selectedChain = params.chain;
    let selectedToken = params.token;

    if (params.needsChainSelection) {
      document.querySelectorAll(".chain-option").forEach((btn) => {
        btn.addEventListener("click", () => {
          const chain = (btn as HTMLElement).dataset.chain!;
          const tokenMap = CURRENCY_CHAIN_TO_TOKEN[params.currency!];
          if (!tokenMap) return;
          selectedChain = chain;
          selectedToken = tokenMap[chain];
          selectChain(chain, selectedToken);
        });
      });
    }

    document.getElementById("connect-btn")!.addEventListener("click", async () => {
      try {
        // 1. Connect wallet
        setStep("connecting");
        const { walletClient, publicClient, address } = await connectWallet(selectedChain);
        setSender(address);
        updateDebug({ sender: address, chain: selectedChain, token: selectedToken });

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
          // Web creates the swap (chain selected by sender or from URL)
          setStep("creating-swap");
          const swapParams = { ...params, chain: selectedChain, token: selectedToken };
          const swapResult = await createSwap(swapParams, address);
          swapId = swapResult.response.id;
          updateDebug({ swapId });

          setStep("preparing-tx");
          const callData = await getFundingCallData(swapId, selectedToken);
          approveTo = callData.approve.to;
          approveData = callData.approve.data;
          fundTo = callData.createSwap.to;
          fundData = callData.createSwap.data;
        }

        // 2. Approve token spend (skip if allowance already sufficient)
        const requiredAmount = parseUnits(String(params.amount), TOKEN_DECIMALS[selectedToken] ?? 6);
        const currentAllowance = await publicClient.readContract({
          address: approveTo as `0x${string}`,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, fundTo as `0x${string}`],
        });
        updateDebug({ currentAllowance: currentAllowance.toString(), requiredAmount: requiredAmount.toString() });

        if (currentAllowance < requiredAmount) {
          setStep("approve");
          const approveTxHash = await walletClient.sendTransaction({
            to: approveTo as `0x${string}`,
            data: approveData as `0x${string}`,
            account: address,
            chain: walletClient.chain,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
          updateDebug({ approveTx: approveTxHash });
        } else {
          updateDebug({ approveSkipped: true });
        }

        // 3. Fund the swap
        setStep("fund");
        const fundTxHash = await walletClient.sendTransaction({
          to: fundTo as `0x${string}`,
          data: fundData as `0x${string}`,
          account: address,
          chain: walletClient.chain,
        });
        await publicClient.waitForTransactionReceipt({ hash: fundTxHash });
        updateDebug({ fundTx: fundTxHash });

        // 4. Done — poll LendaSwap for completion
        if (params.funding) {
          // Pre-created swap: CLI daemon claims automatically
          setStep("done");
        } else if (swapId) {
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
