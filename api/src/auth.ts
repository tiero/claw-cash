import jwt from "jsonwebtoken";
import { config } from "./config.js";
import type { SessionClaims, TicketClaims } from "./types.js";

export const signSessionToken = (claims: SessionClaims): string => {
  return jwt.sign(claims, config.sessionSigningSecret, {
    algorithm: "HS256",
    expiresIn: config.sessionTtlSeconds
  });
};

export const verifySessionToken = (token: string): SessionClaims => {
  return jwt.verify(token, config.sessionSigningSecret, {
    algorithms: ["HS256"]
  }) as SessionClaims;
};

export const signTicketToken = (claims: TicketClaims): string => {
  return jwt.sign(claims, config.ticketSigningSecret, {
    algorithm: "HS256",
    expiresIn: config.ticketTtlSeconds
  });
};

export const verifyTicketToken = (token: string): TicketClaims => {
  return jwt.verify(token, config.ticketSigningSecret, {
    algorithms: ["HS256"]
  }) as TicketClaims;
};
