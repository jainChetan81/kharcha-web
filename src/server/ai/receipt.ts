export async function readReceipt(_attachmentIds: number[], _txnId: number): Promise<{ ok: true; items: { name: string; qty: number | null; amount: number; category: string }[]; total: number | null } | { ok: false; reason: string }> {
  return { ok: false, reason: "AI is off" };
}
