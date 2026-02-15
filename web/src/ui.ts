import type { PaymentParams } from "./params.js";
import { TOKEN_LABELS, CHAIN_LABELS } from "./params.js";

export function renderPage(params: PaymentParams) {
  const tokenLabel = TOKEN_LABELS[params.token] ?? params.token;
  const chainLabel = CHAIN_LABELS[params.chain] ?? params.chain;

  document.getElementById("app")!.innerHTML = `
    <div class="card">
      <h1>clw.cash</h1>
      <p class="amount">${params.amount} ${tokenLabel}</p>
      <p class="chain">on ${chainLabel}</p>
      <div id="status-area">
        <button id="connect-btn">Connect Wallet & Pay</button>
      </div>
      <p id="error" class="error" hidden></p>
    </div>
  `;
}

const STEP_MESSAGES: Record<string, string> = {
  connecting: "Connecting wallet...",
  "creating-swap": "Creating swap...",
  "preparing-tx": "Preparing transactions...",
  approve: "Approve token spend in your wallet...",
  fund: "Confirm funding transaction...",
  waiting: "Waiting for swap to complete...",
  done: "Payment complete!",
  failed: "Swap failed or expired.",
};

export function setStep(step: string) {
  const area = document.getElementById("status-area")!;
  if (step === "done") {
    area.innerHTML = `<p class="step success">${STEP_MESSAGES[step]}</p>`;
  } else if (step === "failed") {
    area.innerHTML = `<p class="step error-text">${STEP_MESSAGES[step]}</p>`;
  } else {
    area.innerHTML = `
      <p class="step">${STEP_MESSAGES[step] ?? step}</p>
      <div class="spinner"></div>
    `;
  }
}

export function setStatus(rawStatus: string) {
  let el = document.getElementById("raw-status");
  if (!el) {
    el = document.createElement("p");
    el.id = "raw-status";
    el.className = "raw-status";
    document.getElementById("status-area")!.appendChild(el);
  }
  el.textContent = rawStatus;
}

export function showError(message: string) {
  const errEl = document.getElementById("error");
  if (errEl) {
    errEl.textContent = message;
    errEl.hidden = false;
  } else {
    document.getElementById("app")!.innerHTML = `
      <div class="card">
        <h1>clw.cash</h1>
        <p class="error-text">${message}</p>
      </div>
    `;
  }
}
