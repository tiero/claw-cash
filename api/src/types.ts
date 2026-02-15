export type SupportedAlg = "secp256k1";

export interface User {
  id: string;
  telegram_user_id: string;
  status: "pending" | "active";
  created_at: string;
}

export interface Identity {
  id: string;
  user_id: string;
  alg: SupportedAlg;
  public_key: string;
  status: "active" | "destroyed";
  created_at: string;
}

export interface Ticket {
  id: string;
  identity_id: string;
  digest_hash: string;
  scope: "sign";
  expires_at: string;
  nonce: string;
  used_at: string | null;
}

export interface AuditEvent {
  id: string;
  user_id: string;
  identity_id: string | null;
  action: "user.create" | "session.create" | "identity.create" | "identity.restore" | "identity.sign" | "identity.destroy";
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface KeyBackup {
  identity_id: string;
  alg: SupportedAlg;
  sealed_key: string;
  created_at: string;
  updated_at: string;
}

export interface Challenge {
  id: string;
  telegram_user_id: string | null;
  created_at: string;
  expires_at: string;
}

export interface SessionClaims {
  sub: string;
  telegram_user_id: string;
}

export interface TicketClaims {
  jti: string;
  sub: string;
  identity_id: string;
  digest_hash: string;
  scope: "sign";
  nonce: string;
}
