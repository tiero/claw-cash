import jwt from "jsonwebtoken";
import { config } from "./config.js";
import type { ConfirmClaims, SessionClaims, TicketClaims } from "./types.js";

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

export const signConfirmToken = (claims: ConfirmClaims): string => {
  return jwt.sign(claims, config.confirmTokenSecret, {
    algorithm: "HS256",
    expiresIn: config.confirmTokenTtlSeconds
  });
};

export const verifyConfirmToken = (token: string): ConfirmClaims => {
  return jwt.verify(token, config.confirmTokenSecret, {
    algorithms: ["HS256"]
  }) as ConfirmClaims;
};
