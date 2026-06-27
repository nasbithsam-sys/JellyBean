import { useEffect, useState } from "react";

/**
 * Hook to detect if the client's system clock is out of sync (skewed)
 * relative to the hosting server. A skew of > 2 minutes will cause
 * Supabase auth tokens to fail validation or refresh loops, leading to 429 errors.
 */
export function useClockSkew() {
  const [skewSeconds, setSkewSeconds] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    async function checkSkew() {
      try {
        const start = Date.now();
        // Fetch a lightweight page/asset from the same origin to read the Date header
        // without CORS issues.
        const response = await fetch(window.location.origin + "/index.html", {
          method: "HEAD",
          cache: "no-store",
        });

        if (!active) return;

        const dateHeader = response.headers.get("date");
        if (dateHeader) {
          const serverTime = new Date(dateHeader).getTime();
          const end = Date.now();
          const latency = (end - start) / 2;
          const adjustedLocalTime = start + latency;
          const diffSeconds = Math.round((adjustedLocalTime - serverTime) / 1000);

          // If skew is greater than 120 seconds (2 minutes), report it.
          if (Math.abs(diffSeconds) > 120) {
            console.warn(`[ClockSkew] System clock skew detected: ${diffSeconds}s`);
            setSkewSeconds(diffSeconds);
          }
        }
      } catch (e) {
        // Fall back to a simple GET if HEAD is not supported/configured on the server
        try {
          const start = Date.now();
          const response = await fetch(window.location.origin + "/index.html", {
            method: "GET",
            cache: "no-store",
          });

          if (!active) return;

          const dateHeader = response.headers.get("date");
          if (dateHeader) {
            const serverTime = new Date(dateHeader).getTime();
            const end = Date.now();
            const latency = (end - start) / 2;
            const adjustedLocalTime = start + latency;
            const diffSeconds = Math.round((adjustedLocalTime - serverTime) / 1000);

            if (Math.abs(diffSeconds) > 120) {
              setSkewSeconds(diffSeconds);
            }
          }
        } catch (err) {
          console.error("[ClockSkew] Failed to measure clock skew:", err);
        }
      }
    }

    checkSkew();

    return () => {
      active = false;
    };
  }, []);

  return skewSeconds;
}
