export interface RemoteSignerConfig {
  /** Base URL of the clw.cash API (e.g., "http://localhost:4000") */
  apiBaseUrl: string;
  /** UUID of the identity on the server */
  identityId: string;
  /** JWT session token from /v1/auth/verify */
  sessionToken: string;
  /** Hex-encoded 33-byte compressed public key (from identity creation) */
  compressedPublicKey: string;
}

export interface SignIntentResponse {
  id: string;
  identity_id: string;
  digest_hash: string;
  nonce: string;
  scope: "sign";
  expires_at: string;
  ticket: string;
}

export interface SignResponse {
  signature: string;
  r?: string;
  s?: string;
  v?: number;
}

export interface EcdsaSignResponse {
  signature: string;
  r: string;
  s: string;
  v: number;
}

export interface SignBatchResponse {
  signatures: Array<{ signature: string; r?: string; s?: string; v?: number }>;
}

export interface CreateIdentityResponse {
  id: string;
  user_id: string;
  alg: "secp256k1";
  public_key: string;
  status: "active";
  created_at: string;
}

export interface ListIdentitiesResponse {
  items: CreateIdentityResponse[];
}

export interface InputDigest {
  inputIndex: number;
  digest: Uint8Array;
  signatureType: "schnorr";
  isTapKeyPath: boolean;
  leafHash?: Uint8Array;
  signerPubKey?: Uint8Array;
}
