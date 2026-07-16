// Host signaling for the direct sink — the ONLY things the host does for a direct stream:
//   echo    POST /reachability/echo        dial the broadcaster from OUTSIDE (the eligibility truth)
//   announce POST/DELETE /live/direct/:id  publish the broadcaster's watch URL so viewers can find it
// No media byte ever touches the host on this lane.

export interface DirectSignalClient {
  /** True when the host dialed the advertised port back successfully (TCP handshake from outside). */
  readonly verifyReachable: (port: number) => Promise<boolean>;
  /** Fail-open: an announce failure must never stop a reachable broadcaster from going live. */
  readonly announce: (streamId: string, watchUrl: string) => Promise<void>;
  readonly withdraw: (streamId: string) => Promise<void>;
}

export const createDirectSignalClient = (hostBaseUrl: string): DirectSignalClient => {
  const base = hostBaseUrl.replace(/\/+$/, "");
  return {
    verifyReachable: async (port) => {
      try {
        const response = await fetch(`${base}/reachability/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ port })
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { reachable?: unknown };
        return body.reachable === true;
      } catch {
        return false;
      }
    },
    announce: async (streamId, watchUrl) => {
      await fetch(`${base}/live/direct/${encodeURIComponent(streamId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ watchUrl })
      }).catch(() => undefined);
    },
    withdraw: async (streamId) => {
      await fetch(`${base}/live/direct/${encodeURIComponent(streamId)}`, {
        method: "DELETE"
      }).catch(() => undefined);
    }
  };
};
