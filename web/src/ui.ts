import type { PaymentParams } from "./params.js";
import { TOKEN_LABELS, CHAIN_LABELS, CHAIN_COLORS, TOKEN_COLORS } from "./params.js";

// ── Icons ──

const COPY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

// Arkade logo — pixelated "A" arcade robot (traced from brand asset)
const ARKADE_LOGO = `<svg width="20" height="20" viewBox="0 0 36 36" fill="currentColor">
  <path d="M6 14 L6 6 Q6 2 10 2 L26 2 Q30 2 30 6 L30 14 L24 14 L24 8 L12 8 L12 14 Z"/>
  <rect x="12" y="16" width="12" height="8" rx="1"/>
  <rect x="6" y="28" width="8" height="6" rx="1"/>
  <rect x="22" y="28" width="8" height="6" rx="1"/>
</svg>`;

// Small version for footer
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
  phase: 1 | 2;
  explainer?: string;
}

const STEPS: Record<string, StepInfo> = {
  loading: {
    title: "Loading\u2026",
    desc: "fetching payment details",
    phase: 1,
  },
  "already-paid": {
    title: "Already paid",
    desc: "this payment link has already been used",
    phase: 2,
  },
  "link-expired": {
    title: "Link expired",
    desc: "this payment link is no longer valid",
    phase: 2,
  },
  connecting: {
    title: "Connecting wallet\u2026",
    desc: "approve the connection in your wallet",
    phase: 1,
  },
  "creating-swap": {
    title: "Preparing your swap\u2026",
    desc: "hang tight, setting things up",
    phase: 2,
  },
  "preparing-tx": {
    title: "Building transactions\u2026",
    desc: "almost there",
    phase: 2,
  },
  approve: {
    title: "Approve token spend",
    desc: "your wallet needs a quick ok",
    phase: 2,
    explainer:
      "A popup will ask to approve token spending. This is a standard ERC-20 permission \u2014 no funds leave your wallet yet.",
  },
  fund: {
    title: "Confirm payment",
    desc: "last step, send it",
    phase: 2,
    explainer:
      "Your wallet will confirm the actual payment. This sends stablecoins to complete the swap \u2192 bitcoin.",
  },
  waiting: {
    title: "Processing\u2026",
    desc: "waiting for on-chain confirmation",
    phase: 2,
  },
  done: {
    title: "Sent!",
    desc: "bitcoin is on its way",
    phase: 2,
  },
  failed: {
    title: "Failed",
    desc: "swap expired or hit an error",
    phase: 2,
  },
};

// ── Helpers ──

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

function tokenDot(token: string): string {
  const c = TOKEN_COLORS[token] ?? "#888";
  return `<span class="token-dot" style="background:${c}"></span>`;
}

function chainDot(chain: string): string {
  const c = CHAIN_COLORS[chain] ?? "#888";
  return `<span class="chain-dot" style="background:${c}"></span>`;
}

function brandHeader(): string {
  return `
    <div class="brand-header">
      <div class="brand-left">
        <span class="brand-logo">${ARKADE_LOGO}</span>
        <span class="brand-name">Arkade</span>
      </div>
      <span class="brand-tag">Checkout</span>
    </div>`;
}

function footer(): string {
  return `
    <div class="footer">
      <p class="footer-tagline">
        <em>bots get bitcoins</em>, humans pay in stablecoins
      </p>
      <p class="footer-powered">powered by <span class="footer-arkade">${ARKADE_LOGO_SM} Arkade</span></p>
    </div>`;
}

function stepIndicatorHtml(phase: 0 | 1 | 2, terminal?: "done" | "failed"): string {
  const s1 = terminal || phase >= 2 ? "completed" : phase === 1 ? "active" : "inactive";
  const s1c = s1 === "completed" ? CHECK_SVG : "1";
  const lineC = terminal || phase >= 2 ? "completed" : "";

  let s2: string;
  let s2c: string;
  if (terminal === "done") { s2 = "completed"; s2c = CHECK_SVG; }
  else if (terminal === "failed") { s2 = "error"; s2c = "!"; }
  else if (phase === 2) { s2 = "active"; s2c = "2"; }
  else { s2 = "inactive"; s2c = "2"; }

  const l1 = phase >= 1 || terminal ? "active" : "";
  const l2 = phase >= 2 || terminal ? "active" : "";

  return `
    <div class="step-indicator">
      <div class="step-node">
        <div class="step-circle ${s1}">${s1c}</div>
        <span class="step-label ${l1}">Connect</span>
      </div>
      <div class="step-line ${lineC}"></div>
      <div class="step-node">
        <div class="step-circle ${s2}">${s2c}</div>
        <span class="step-label ${l2}">Pay</span>
      </div>
    </div>`;
}

// ── Render ──

export function renderPage(params: PaymentParams) {
  const tok = TOKEN_LABELS[params.token] ?? params.token;
  const chain = CHAIN_LABELS[params.chain] ?? params.chain;

  document.getElementById("app")!.innerHTML = `
    <div class="checkout-card">

      ${brandHeader()}

      <div class="amount-hero">
        <div class="amount-value">${params.amount}</div>
        <div class="amount-meta">
          <span class="amount-token">
            ${tokenDot(params.token)}
            ${tok}
          </span>
          <span class="meta-sep">\u00B7</span>
          <span class="chain-pill">
            ${chainDot(params.chain)}
            ${chain}
          </span>
        </div>
      </div>

      <div id="transfer-section" class="transfer-section">
        <div id="sender-row" class="transfer-row" hidden>
          <div class="transfer-left">
            <div class="transfer-avatar sender-avatar" id="sender-avatar">\uD83D\uDC64</div>
            <div class="transfer-info">
              <div class="transfer-label">From</div>
              <div class="address-text" id="sender-display"></div>
            </div>
          </div>
        </div>
        <div id="transfer-arrow" class="transfer-arrow" hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
        </div>
        <div class="transfer-row">
          <div class="transfer-left">
            <div class="transfer-avatar">\uD83E\uDD16</div>
            <div class="transfer-info">
              <div class="transfer-label">To</div>
              <div id="ens-name" class="ens-name" hidden></div>
              <div class="address-text" id="address-display">${truncAddr(params.to)}</div>
            </div>
          </div>
          <button class="copy-btn" id="copy-btn" title="Copy address">${COPY_SVG}</button>
        </div>
      </div>

      ${stepIndicatorHtml(0)}

      <div id="action-area" class="action-area">
        <button class="action-btn" id="connect-btn">Connect Wallet & Pay</button>
      </div>

      <div id="explainer-area"></div>
      <div id="error-area"></div>

      ${footer()}
    </div>
  `;

  // Copy handler
  const addr = params.to;
  document.getElementById("copy-btn")!.addEventListener("click", () => {
    navigator.clipboard.writeText(addr).then(() => {
      const btn = document.getElementById("copy-btn")!;
      btn.innerHTML = CHECK_SVG;
      btn.classList.add("copied");
      setTimeout(() => {
        btn.innerHTML = COPY_SVG;
        btn.classList.remove("copied");
      }, 1500);
    });
  });
}

// ── Step Updates ──

export function setStep(step: string) {
  const info = STEPS[step];
  if (!info) return;

  // Loading step: show before page is rendered (no card yet)
  if (step === "loading") {
    const app = document.getElementById("app");
    if (app && !document.querySelector(".checkout-card")) {
      app.innerHTML = `
        <div class="checkout-card">
          ${brandHeader()}
          <div class="status-message">
            <p class="status-title">${info.title}</p>
            <p class="status-description">${info.desc}</p>
          </div>
          <button class="action-btn" disabled>
            <span class="spinner"></span>
            ${info.title}
          </button>
          ${footer()}
        </div>`;
    }
    return;
  }

  const card = document.querySelector(".checkout-card");
  if (!card) return;

  // Swap step indicator
  const old = card.querySelector(".step-indicator");
  if (old) {
    const t = step === "done" || step === "already-paid" ? "done" : step === "failed" || step === "link-expired" ? "failed" : undefined;
    const wrap = document.createElement("div");
    wrap.innerHTML = stepIndicatorHtml(info.phase, t as "done" | "failed" | undefined);
    old.replaceWith(wrap.firstElementChild!);
  }

  // Action area
  const area = document.getElementById("action-area")!;

  if (step === "done") {
    area.innerHTML = `
      <div class="result-area">
        <div class="result-icon success">${CHECK_SVG}</div>
        <p class="status-title success">${info.title}</p>
        <p class="status-description">${info.desc}</p>
      </div>`;
  } else if (step === "failed" || step === "link-expired") {
    area.innerHTML = `
      <div class="result-area">
        <div class="result-icon error">!</div>
        <p class="status-title error">${info.title}</p>
        <p class="status-description">${info.desc}</p>
      </div>`;
  } else if (step === "already-paid") {
    area.innerHTML = `
      <div class="result-area">
        <div class="result-icon success">${CHECK_SVG}</div>
        <p class="status-title success">${info.title}</p>
        <p class="status-description">${info.desc}</p>
      </div>`;
  } else {
    area.innerHTML = `
      <div class="status-message">
        <p class="status-title">${info.title}</p>
        <p class="status-description">${info.desc}</p>
      </div>
      <button class="action-btn" disabled>
        <span class="spinner"></span>
        ${info.title}
      </button>`;
  }

  // Explainer
  const explArea = document.getElementById("explainer-area")!;
  if (info.explainer) {
    explArea.innerHTML = `
      <div class="popup-explainer">
        <span class="explainer-icon">\uD83D\uDC46</span>
        <div class="explainer-content">
          <p class="explainer-title">wallet popup incoming</p>
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
  const row = document.getElementById("sender-row");
  const arrow = document.getElementById("transfer-arrow");
  const display = document.getElementById("sender-display");
  if (row && arrow && display) {
    display.textContent = truncAddr(address);
    row.hidden = false;
    arrow.hidden = false;
  }
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
      </div>`;
  }
}
