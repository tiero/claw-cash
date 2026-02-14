import type { SupportedAlg } from "./types.js";

interface GenerateResponse {
  public_key: string;
}

interface SignResponse {
  signature: string;
}

interface DestroyResponse {
  ok: boolean;
}

interface ExportKeyResponse {
  alg: SupportedAlg;
  private_key: string;
}

type JsonMap = Record<string, unknown>;

export class EnclaveClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalApiKey: string,
    private readonly evApiKey?: string
  ) {}

  async generate(walletId: string, alg: SupportedAlg): Promise<GenerateResponse> {
    return this.request<GenerateResponse>("/internal/generate", {
      wallet_id: walletId,
      alg
    });
  }

  async sign(walletId: string, digest: string, ticket: string): Promise<SignResponse> {
    return this.request<SignResponse>("/internal/sign", {
      wallet_id: walletId,
      digest,
      ticket
    });
  }

  async destroy(walletId: string): Promise<DestroyResponse> {
    return this.request<DestroyResponse>("/internal/destroy", {
      wallet_id: walletId
    });
  }

  async exportKey(walletId: string): Promise<ExportKeyResponse> {
    return this.request<ExportKeyResponse>("/internal/backup/export", {
      wallet_id: walletId
    });
  }

  async importKey(walletId: string, alg: SupportedAlg, privateKey: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("/internal/backup/import", {
      wallet_id: walletId,
      alg,
      private_key: privateKey
    });
  }

  private async request<T>(path: string, body: JsonMap): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-internal-api-key": this.internalApiKey
    };
    if (this.evApiKey) {
      headers["api-key"] = this.evApiKey;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const text = await response.text();
    console.log(`[EnclaveClient] ${path} -> ${response.status} ${text.substring(0, 200)}`);

    if (!response.ok) {
      let details = "";
      try {
        const parsed = JSON.parse(text) as { error?: string };
        details = parsed.error ?? JSON.stringify(parsed);
      } catch {
        details = text;
      }
      throw new EnclaveClientError(response.status, details || "Unknown enclave error");
    }
    return JSON.parse(text) as T;
  }
}

export class EnclaveClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}
