import type { PaymentParams } from "./params.js";
import { TOKEN_LABELS, CHAIN_LABELS, CHAIN_COLORS, TOKEN_COLORS, SUPPORTED_CHAINS, TOKEN_LOGOS, CURRENCY_LOGOS } from "./params.js";

// ── Icons ──

const COPY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ARROW_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;
const INFO_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

const ARKADE_LOGO_SM = `<svg width="12" height="12" viewBox="0 0 36 36" fill="currentColor">
  <path d="M6 14 L6 6 Q6 2 10 2 L26 2 Q30 2 30 6 L30 14 L24 14 L24 8 L12 8 L12 14 Z"/>
  <rect x="12" y="16" width="12" height="8" rx="1"/>
  <rect x="6" y="28" width="8" height="6" rx="1"/>
  <rect x="22" y="28" width="8" height="6" rx="1"/>
</svg>`;

// ── Step Config ──

interface StepInfo {
  title: string;
  desc: string;
  progress: number; // 0-100
  explainer?: string;
}

const STEPS: Record<string, StepInfo> = {
  loading:        { title: "Loading\u2026",            desc: "fetching payment details",           progress: 0 },
  "already-paid": { title: "Already paid",             desc: "This payment link has been used",    progress: 100 },
  "link-expired": { title: "Link expired",             desc: "This payment link is no longer valid", progress: 0 },
  connecting:     { title: "Connecting\u2026",          desc: "Approve in your wallet",             progress: 15 },
  "creating-swap":{ title: "Preparing swap\u2026",     desc: "Setting things up",                  progress: 30 },
  "preparing-tx": { title: "Building tx\u2026",        desc: "Almost there",                       progress: 40 },
  approve:        { title: "Step 1 of 2: Approve",     desc: "Check your wallet",                  progress: 50,
    explainer: "Your wallet will ask to approve token spending. This is a standard permission \u2014 no funds leave yet. A second confirmation will follow." },
  fund:           { title: "Confirm payment",          desc: "Last step",                          progress: 70,
    explainer: "Your wallet will confirm the payment. This sends stablecoins to complete the swap to bitcoin." },
  waiting:        { title: "Processing\u2026",          desc: "Waiting for confirmation",           progress: 85 },
  done:           { title: "Sent!",                    desc: "Bitcoin is on its way",              progress: 100 },
  failed:         { title: "Failed",                   desc: "Swap expired or hit an error",       progress: 100 },
};

// ── Helpers ──

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

function tokenLogo(token: string): string {
  const logo = TOKEN_LOGOS[token];
  if (logo) return `<span class="token-logo">${logo}</span>`;
  const c = TOKEN_COLORS[token] ?? "#888";
  return `<span class="token-dot" style="background:${c}"></span>`;
}

function currencyLogo(currency: string): string {
  const logo = CURRENCY_LOGOS[currency];
  if (logo) return `<span class="token-logo">${logo}</span>`;
  return "";
}

function chainDot(chain: string): string {
  const c = CHAIN_COLORS[chain] ?? "#888";
  return `<span class="chain-dot" style="background:${c}"></span>`;
}

// ── Layout parts ──

function brandHeader(): string {
  return `
    <div class="brand-header">
      <div>
        <div class="brand-name">Cash for Claws</div>
        <div class="brand-tagline"><em>bots get bitcoins</em>, humans pay in stablecoins</div>
      </div>
      <button class="debug-toggle" id="debug-toggle" title="Diagnostics">${INFO_SVG}</button>
    </div>`;
}

function debugPanelHtml(): string {
  return `
    <div class="debug-panel" id="debug-panel" hidden>
      <div class="debug-title">Diagnostics</div>
      <pre class="debug-content" id="debug-content"></pre>
    </div>`;
}

function pageFooter(): string {
  return `
    <div class="page-footer">
      <p class="footer-powered">powered by <a href="https://arkadeos.com" target="_blank" rel="noopener" class="footer-arkade">${ARKADE_LOGO_SM} Arkade</a></p>
    </div>`;
}

function amountHtml(params: PaymentParams): string {
  const cur = params.needsChainSelection
    ? (params.currency ?? "").toUpperCase()
    : (TOKEN_LABELS[params.token] ?? params.token);

  const logo = params.needsChainSelection
    ? currencyLogo(params.currency ?? "")
    : tokenLogo(params.token);

  let meta = "";
  if (!params.needsChainSelection && params.chain) {
    const chainLabel = CHAIN_LABELS[params.chain] ?? params.chain;
    meta = `
      <div class="amount-meta">
        ${tokenLogo(params.token)} ${cur}
        <span class="meta-sep">\u00B7</span>
        ${chainDot(params.chain)} ${chainLabel}
      </div>`;
  }

  return `
    <div class="amount-section">
      <div class="amount-value">${logo} ${params.amount}<span class="amount-currency">${cur}</span></div>
      ${meta}
    </div>`;
}

function chainPickerHtml(): string {
  const items = SUPPORTED_CHAINS.map((c) => {
    const color = CHAIN_COLORS[c] ?? "#888";
    return `
      <button class="chain-option" data-chain="${c}">
        <span class="chain-dot" style="background:${color}"></span>
        ${CHAIN_LABELS[c] ?? c}
      </button>`;
  }).join("");

  return `
    <div class="chain-picker">
      <div class="chain-picker-label">Pay on</div>
      <div class="chain-picker-options">${items}</div>
    </div>`;
}

function recipientHtml(params: PaymentParams): string {
  return `
    <div class="recipient-section" id="recipient-section">
      <div class="recipient-left">
        <div class="recipient-avatar">\uD83E\uDD16</div>
        <div class="recipient-info">
          <div class="recipient-label">To</div>
          <div id="ens-name" class="recipient-ens" hidden></div>
          <div class="recipient-address" id="address-display">${truncAddr(params.to)}</div>
        </div>
      </div>
      <button class="copy-btn" id="copy-btn" title="Copy address">${COPY_SVG}</button>
    </div>`;
}

// ── Render ──

export function renderPage(params: PaymentParams) {
  const showChainPicker = !!params.needsChainSelection;

  document.getElementById("app")!.innerHTML = `
    <div class="checkout-card">
      ${brandHeader()}
      ${amountHtml(params)}
      ${showChainPicker ? chainPickerHtml() : ""}
      ${recipientHtml(params)}

      <div id="sender-area"></div>
      <div id="progress-area"></div>
      <div id="action-area" class="action-area">
        <button class="action-btn" id="connect-btn" ${showChainPicker ? "disabled" : ""}>Connect Wallet & Pay</button>
      </div>
      <div id="explainer-area"></div>
      <div id="error-area"></div>

      ${debugPanelHtml()}
    </div>
    ${pageFooter()}
  `;

  // Copy handler
  const addr = params.to;
  document.getElementById("copy-btn")!.addEventListener("click", () => {
    navigator.clipboard.writeText(addr).then(() => {
      const btn = document.getElementById("copy-btn")!;
      btn.innerHTML = CHECK_SVG;
      btn.classList.add("copied");
      setTimeout(() => { btn.innerHTML = COPY_SVG; btn.classList.remove("copied"); }, 1500);
    });
  });

  // Debug toggle
  document.getElementById("debug-toggle")!.addEventListener("click", () => {
    const panel = document.getElementById("debug-panel")!;
    panel.hidden = !panel.hidden;
  });

  // Initial debug data
  updateDebug({
    swapId: params.swapId ?? null,
    token: params.token || null,
    chain: params.chain || null,
    currency: params.currency ?? null,
    amount: params.amount,
    to: params.to,
    status: params.status,
    hasFunding: !!params.funding,
    needsChainSelection: !!params.needsChainSelection,
    url: window.location.href,
  });
}

// ── Chain selection ──

export function selectChain(chain: string, token: string) {
  // Update amount meta
  const section = document.querySelector(".amount-section");
  if (section) {
    const existing = section.querySelector(".amount-meta");
    const chainLabel = CHAIN_LABELS[chain] ?? chain;
    const tok = TOKEN_LABELS[token] ?? token;
    const html = `
      <div class="amount-meta">
        ${tokenLogo(token)} ${tok}
        <span class="meta-sep">\u00B7</span>
        ${chainDot(chain)} ${chainLabel}
      </div>`;
    if (existing) {
      existing.outerHTML = html;
    } else {
      section.insertAdjacentHTML("beforeend", html);
    }
  }

  // Highlight selected
  document.querySelectorAll(".chain-option").forEach((btn) => {
    btn.classList.toggle("selected", (btn as HTMLElement).dataset.chain === chain);
  });

  // Enable button
  const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement | null;
  if (connectBtn) connectBtn.disabled = false;
}

// ── Step updates ──

export function setStep(step: string) {
  const info = STEPS[step];
  if (!info) return;

  // Loading: before page renders
  if (step === "loading") {
    const app = document.getElementById("app");
    if (app && !document.querySelector(".checkout-card")) {
      app.innerHTML = `
        <div class="checkout-card">
          ${brandHeader()}
          <div class="status-area">
            <p class="status-title">${info.title}</p>
            <p class="status-desc">${info.desc}</p>
          </div>
          <button class="action-btn" disabled><span class="spinner"></span> ${info.title}</button>
        </div>
        ${pageFooter()}`;
    }
    return;
  }

  const card = document.querySelector(".checkout-card");
  if (!card) return;

  // Terminal states: hide amount + recipient, show only the result
  const isTerminal = step === "already-paid" || step === "link-expired" || step === "failed";
  const amountEl = card.querySelector(".amount-section") as HTMLElement | null;
  const recipientEl = document.getElementById("recipient-section") as HTMLElement | null;
  const chainPicker = card.querySelector(".chain-picker") as HTMLElement | null;
  if (amountEl) amountEl.style.display = isTerminal ? "none" : "";
  if (recipientEl) recipientEl.style.display = isTerminal ? "none" : "";
  if (chainPicker) chainPicker.style.display = isTerminal ? "none" : "";

  // Progress bar — animate towards target over ~60s, pulsing while in progress
  const progArea = document.getElementById("progress-area")!;
  const shouldShow = info.progress > 0 && !isTerminal && step !== "done";
  if (shouldShow) {
    let fill = progArea.querySelector(".progress-fill") as HTMLElement | null;
    if (!fill) {
      progArea.innerHTML = `<div class="progress-bar"><div class="progress-fill"></div></div>`;
      fill = progArea.querySelector(".progress-fill") as HTMLElement;
    }
    // Start from 0 width, then animate to target on next frame
    requestAnimationFrame(() => {
      fill!.classList.remove("instant");
      fill!.classList.add("animating");
      fill!.style.width = `${info.progress}%`;
    });
  } else if (step === "done") {
    // Snap to 100% quickly on success
    const fill = progArea.querySelector(".progress-fill") as HTMLElement | null;
    if (fill) {
      fill.classList.remove("animating");
      fill.classList.add("instant");
      fill.style.width = "100%";
      fill.style.animation = "none";
      // Remove bar after transition
      setTimeout(() => { progArea.innerHTML = ""; }, 500);
    } else {
      progArea.innerHTML = "";
    }
  } else {
    progArea.innerHTML = "";
  }

  // Action area
  const area = document.getElementById("action-area")!;

  if (step === "done") {
    area.innerHTML = `
      <div class="result-area">
        <div class="result-icon success">${CHECK_SVG}</div>
        <p class="result-title">${info.title}</p>
        <p class="result-desc">${info.desc}</p>
      </div>`;
  } else if (step === "already-paid") {
    area.innerHTML = `
      <div class="result-area">
        <div class="result-icon success">${CHECK_SVG}</div>
        <p class="result-title">${info.title}</p>
        <p class="result-desc">${info.desc}</p>
      </div>`;
  } else if (step === "failed" || step === "link-expired") {
    area.innerHTML = `
      <div class="result-area">
        <div class="result-icon muted">!</div>
        <p class="result-title">${info.title}</p>
        <p class="result-desc">${info.desc}</p>
      </div>`;
  } else {
    area.innerHTML = `
      <div class="status-area">
        <p class="status-title">${info.title}</p>
        <p class="status-desc">${info.desc}</p>
      </div>
      <button class="action-btn" disabled><span class="spinner"></span> ${info.title}</button>`;
  }

  // Log to debug
  updateDebug({ step, progress: info.progress });

  // Explainer
  const explArea = document.getElementById("explainer-area")!;
  if (info.explainer) {
    explArea.innerHTML = `
      <div class="explainer">
        <span class="explainer-icon">\uD83D\uDC46</span>
        <div>
          <p class="explainer-title">Wallet popup incoming</p>
          <p class="explainer-text">${info.explainer}</p>
        </div>
      </div>`;
  } else {
    explArea.innerHTML = "";
  }
}

export function setStatus(rawStatus: string) {
  let el = document.getElementById("raw-status");
  if (!el) {
    el = document.createElement("p");
    el.id = "raw-status";
    el.className = "raw-status";
    document.getElementById("action-area")!.appendChild(el);
  }
  el.textContent = rawStatus;
}

export function setSender(address: string) {
  const area = document.getElementById("sender-area")!;
  area.innerHTML = `
    <div class="sender-section">
      <div class="sender-avatar">\uD83D\uDC64</div>
      <div>
        <div class="recipient-label">From</div>
        <div class="recipient-address">${truncAddr(address)}</div>
      </div>
    </div>
    <div class="transfer-arrow">${ARROW_SVG}</div>`;
}

export function setEnsName(name: string) {
  const el = document.getElementById("ens-name");
  if (el) {
    el.textContent = name;
    el.hidden = false;
  }
}

export function showError(msg: string) {
  const area = document.getElementById("error-area");
  if (area) {
    area.innerHTML = `<div class="error-box"><p class="error-text">${msg}</p></div>`;
  } else {
    document.getElementById("app")!.innerHTML = `
      <div class="checkout-card">
        ${brandHeader()}
        <div class="error-box"><p class="error-text">${msg}</p></div>
      </div>
      ${pageFooter()}`;
  }
  updateDebug({ error: msg });
}

// ── Debug panel ──

const debugState: Record<string, unknown> = {};

export function updateDebug(data: Record<string, unknown>) {
  Object.assign(debugState, data);
  const el = document.getElementById("debug-content");
  if (el) el.textContent = JSON.stringify(debugState, null, 2);
}
