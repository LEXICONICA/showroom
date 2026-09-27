import { NextResponse } from "next/server";

export function proxy() {
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  return response;
}

export const config = { matcher: "/:path*" };
