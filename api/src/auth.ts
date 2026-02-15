import { SignJWT, jwtVerify } from "jose";
import type { SessionClaims, TicketClaims } from "./types.js";

const encoder = new TextEncoder();

export const signSessionToken = async (
  claims: SessionClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> => {
  return new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));
};

export const verifySessionToken = async (
  token: string,
  secret: string,
): Promise<SessionClaims> => {
  const { payload } = await jwtVerify(token, encoder.encode(secret), {
    algorithms: ["HS256"],
  });
  return payload as unknown as SessionClaims;
};

export const signTicketToken = async (
  claims: TicketClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> => {
  return new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));
};

export const verifyTicketToken = async (
  token: string,
  secret: string,
): Promise<TicketClaims> => {
  const { payload } = await jwtVerify(token, encoder.encode(secret), {
    algorithms: ["HS256"],
  });
  return payload as unknown as TicketClaims;
};
