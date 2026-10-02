import { useEffect, useState } from "react";

import { getNodeStatus, type NodeStatus } from "./node-bridge";

const POLL_MS = 3_000;

const INITIAL: NodeStatus = {
  running: false,
  listening: false,
  paired: false,
};

/**
 * Subscribes to the local node status. Uses a 3 s poll — the same cadence
 * the web app's status UI uses. The hook also re-checks immediately when
 * the window regains focus so pairing changes show up without a refresh.
 */
export function useNodeStatus(): NodeStatus {
  const [status, setStatus] = useState<NodeStatus>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      const next = await getNodeStatus();
      if (cancelled) return;
      setStatus(next);
      timer = setTimeout(tick, POLL_MS);
    };

    void tick();
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return status;
}
