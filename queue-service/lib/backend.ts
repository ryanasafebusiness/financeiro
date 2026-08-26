const backendUrl = () => {
  const value = process.env.BACKEND_URL?.replace(/\/$/, "");
  if (!value) throw new Error("BACKEND_URL binding ausente");
  return value;
};

export async function callBackend<T>(path: string, body: unknown): Promise<T> {
  const secret = process.env.QUEUE_BRIDGE_SECRET;
  if (!secret) throw new Error("QUEUE_BRIDGE_SECRET ausente");

  const response = await fetch(`${backendUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-queue-bridge-secret": secret,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Backend ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}
