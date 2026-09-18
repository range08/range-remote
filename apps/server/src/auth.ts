import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { config, mcpResource } from "./config.js";

const jwks = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL));

export const tokenVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.AUTH_ISSUER,
        audience: config.AUTH_AUDIENCE
      });

      if (!payload.sub || !payload.exp) throw new Error("Token is missing sub or exp");

      const scopes = typeof payload.scope === "string"
        ? payload.scope.split(/\s+/).filter(Boolean)
        : [];

      return {
        token,
        clientId: payload.sub,
        scopes,
        expiresAt: payload.exp,
        resource: new URL(mcpResource)
      };
    } catch (error) {
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        error instanceof Error ? error.message : "Invalid access token"
      );
    }
  }
};
