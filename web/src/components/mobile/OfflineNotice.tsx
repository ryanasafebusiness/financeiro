import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineNotice() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[90] mx-auto flex max-w-sm items-center justify-center gap-2 rounded-pill bg-foreground px-4 py-2 text-meta font-medium text-background shadow-md">
      <WifiOff className="h-4 w-4" />
      Você está offline
    </div>
  );
}
