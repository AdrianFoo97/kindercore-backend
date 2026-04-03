import type { Response } from 'express';

export const sseClients = new Set<Response>();

export function broadcast(event: string, data?: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}
