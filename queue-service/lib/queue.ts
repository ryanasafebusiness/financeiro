import { QueueClient } from "@vercel/queue";

export const INBOUND_TOPIC = "gobbi-inbound";
export const FINALIZE_TOPIC = "gobbi-finalize";

const region = process.env.VERCEL_QUEUE_REGION || "iad1";
export const queue = new QueueClient({ region });
