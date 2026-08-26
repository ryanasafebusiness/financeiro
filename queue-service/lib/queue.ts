import { QueueClient } from "@vercel/queue";

export const INBOUND_TOPIC = "zapwallet-inbound";
export const FINALIZE_TOPIC = "zapwallet-finalize";

const region = process.env.VERCEL_QUEUE_REGION || "iad1";
export const queue = new QueueClient({ region });
