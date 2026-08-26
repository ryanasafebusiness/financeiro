import { callBackend } from "@/lib/backend";
import { queue } from "@/lib/queue";

type FinalizeMessage = {
  sender: string;
  msg_id: string;
};

export const POST = queue.handleCallback(
  async (message: FinalizeMessage) => {
    if (!message?.sender || !message?.msg_id) {
      throw new Error("Mensagem de finalização inválida");
    }
    await callBackend("/internal/queues/finalize", message);
  },
  {
    visibilityTimeoutSeconds: 600,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount > 5) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 10) };
    },
  },
);
