import {useEffect, useState} from "react";
import {resolveArcName} from "@/lib/arc";

export type ArcNameState = {
  arcName: string | null;
  isLoading: boolean;
  error: string | null;
};

export function useArcName(address?: string | null): ArcNameState {
  const [state, setState] = useState<ArcNameState>({
    arcName: null,
    isLoading: false,
    error: null
  });

  useEffect(() => {
    let active = true;

    async function run() {
      if (!address) {
        setState({arcName: null, isLoading: false, error: null});
        return;
      }

      setState((current) => ({...current, isLoading: true, error: null}));
      try {
        const arcName = await resolveArcName(address);
        if (active) setState({arcName, isLoading: false, error: null});
      } catch (error) {
        if (active) {
          setState({
            arcName: null,
            isLoading: false,
            error: error instanceof Error ? error.message : "Unable to resolve .arc name"
          });
        }
      }
    }

    run();
    return () => {
      active = false;
    };
  }, [address]);

  return state;
}

