export type SupportedAlg = "secp256k1";

export interface User {
  id: string;
  telegram_user_id: string;
  status: "pending" | "active";
  created_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  alg: SupportedAlg;
  public_key: string;
  status: "active" | "destroyed";
  created_at: string;
}

export interface Ticket {
  id: string;
  wallet_id: string;
  digest_hash: string;
  scope: "sign";
  expires_at: string;
  nonce: string;
  used_at: string | null;
}

export interface AuditEvent {
  id: string;
  user_id: string;
  wallet_id: string | null;
  action: "user.create" | "user.confirm" | "session.create" | "wallet.create" | "wallet.sign" | "wallet.destroy";
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface KeyBackup {
  wallet_id: string;
  alg: SupportedAlg;
  private_key: string;
  created_at: string;
  updated_at: string;
}

export interface SessionClaims {
  sub: string;
  telegram_user_id: string;
}

export interface ConfirmClaims {
  sub: string;
  telegram_user_id: string;
}

export interface TicketClaims {
  jti: string;
  sub: string;
  wallet_id: string;
  digest_hash: string;
  scope: "sign";
  nonce: string;
}
