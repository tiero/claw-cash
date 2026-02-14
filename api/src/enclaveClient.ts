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
    private readonly internalApiKey: string
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
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": this.internalApiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let details = "";
      try {
        const parsed = (await response.json()) as { error?: string };
        details = parsed.error ?? JSON.stringify(parsed);
      } catch {
        details = await response.text();
      }
      throw new EnclaveClientError(response.status, details || "Unknown enclave error");
    }
    return (await response.json()) as T;
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
