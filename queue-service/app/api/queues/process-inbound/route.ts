import { callBackend } from "@/lib/backend";
import { FINALIZE_TOPIC, queue } from "@/lib/queue";

type FinalizeMessage = {
  sender: string;
  msg_id: string;
  delay_seconds: number;
};

type ProcessResult = {
  status: string;
  finalize: FinalizeMessage | null;
};

export const POST = queue.handleCallback(
  async (message: unknown) => {
    const result = await callBackend<ProcessResult>(
      "/internal/queues/process-inbound",
      message,
    );
    if (result.finalize) {
      const pending = result.finalize;
      await queue.send(
        FINALIZE_TOPIC,
        { sender: pending.sender, msg_id: pending.msg_id },
        {
          delaySeconds: Math.max(0, Math.ceil(pending.delay_seconds)),
          idempotencyKey: `finalize-${pending.msg_id}`,
          retentionSeconds: 86400,
        },
      );
    }
  },
  {
    visibilityTimeoutSeconds: 600,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount > 8) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
    },
  },
);
