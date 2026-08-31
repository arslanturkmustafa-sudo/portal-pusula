"use client";

import { useEffect, useState } from "react";

export function OfflineStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const updateStatus = () => setIsOnline(navigator.onLine);

    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  if (isOnline) {
    return null;
  }

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      İnternet bağlantısı yok. Güncel veriler gösterilemiyor; yeniden bağlanınca
      devam edebilirsiniz.
    </div>
  );
}

