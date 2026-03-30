import type { HttpResponseInit } from "@azure/functions";

export function jsonResponse(body: unknown, status = 200): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  };
}

export function notFoundResponse(message: string): HttpResponseInit {
  return jsonResponse({ message }, 404);
}

export function badRequestResponse(message: string): HttpResponseInit {
  return jsonResponse({ message }, 400);
}

export function unauthorizedResponse(message: string): HttpResponseInit {
  return jsonResponse({ message }, 401);
}

export function internalErrorResponse(message: string): HttpResponseInit {
  return jsonResponse({ message }, 500);
}
