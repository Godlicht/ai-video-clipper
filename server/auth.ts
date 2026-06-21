import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type AuthenticatedRequest = Request & { user?: AuthUser };

export function signToken(user: AuthUser, secret: string) {
  return jwt.sign(user, secret, { expiresIn: "7d", issuer: "cutwise" });
}

export function authRequired(secret: string) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) return response.status(401).json({ error: "Brak tokenu autoryzacyjnego." });

    try {
      request.user = jwt.verify(token, secret, { issuer: "cutwise" }) as AuthUser;
      next();
    } catch {
      response.status(401).json({ error: "Sesja wygasła lub token jest nieprawidłowy." });
    }
  };
}
