import type {
  CreateIdentityResponse,
  ListIdentitiesResponse,
  SignBatchResponse,
  SignIntentResponse,
  SignResponse,
} from "./types.js";

export class ClwApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export class ClwApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly identityId: string,
    private sessionToken: string
  ) {}

  /** Update the session token (e.g., after refresh) */
  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  /** Create a new identity on the server */
  static async createIdentity(
    baseUrl: string,
    sessionToken: string
  ): Promise<CreateIdentityResponse> {
    const res = await fetch(`${baseUrl}/v1/identities`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ alg: "secp256k1" }),
    });
    return ClwApiClient.handleResponse<CreateIdentityResponse>(res);
  }

  /** List all active identities for the authenticated user */
  static async listIdentities(
    baseUrl: string,
    sessionToken: string
  ): Promise<ListIdentitiesResponse> {
    const res = await fetch(`${baseUrl}/v1/identities`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    return ClwApiClient.handleResponse<ListIdentitiesResponse>(res);
  }

  /** Sign a single digest via the two-step flow (sign-intent → sign) */
  async signDigest(digestHex: string): Promise<string> {
    const intent = await this.signIntent(digestHex);
    const signed = await this.sign(digestHex, intent.ticket);
    return signed.signature;
  }

  /** Sign multiple digests in a single batch call */
  async signDigestBatch(
    digests: Array<{ digest: string }>
  ): Promise<string[]> {
    const res = await this.request(
      `/v1/identities/${this.identityId}/sign-batch`,
      {
        digests: digests.map((d) => ({ digest: d.digest })),
      }
    );
    const body = await ClwApiClient.handleResponse<SignBatchResponse>(res);
    return body.signatures;
  }

  private async signIntent(digestHex: string): Promise<SignIntentResponse> {
    const res = await this.request(
      `/v1/identities/${this.identityId}/sign-intent`,
      { digest: digestHex }
    );
    return ClwApiClient.handleResponse<SignIntentResponse>(res);
  }

  private async sign(
    digestHex: string,
    ticket: string
  ): Promise<SignResponse> {
    const res = await this.request(
      `/v1/identities/${this.identityId}/sign`,
      { digest: digestHex, ticket }
    );
    return ClwApiClient.handleResponse<SignResponse>(res);
  }

  private async request(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.sessionToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  private static async handleResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      let message = "API error";
      try {
        const parsed = JSON.parse(text) as { error?: string };
        message = parsed.error ?? text;
      } catch {
        message = text;
      }
      throw new ClwApiError(res.status, message);
    }
    return JSON.parse(text) as T;
  }
}
