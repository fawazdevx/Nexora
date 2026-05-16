import {useQuery} from "@tanstack/react-query";
import {useAccount} from "wagmi";
import {apiGet, appSnapshotPath, type AppSnapshot} from "@/lib/api";

export function useAppSnapshot() {
  const {address} = useAccount();

  return useQuery({
    queryKey: ["app-snapshot", address],
    queryFn: () => apiGet<AppSnapshot>(appSnapshotPath(address)),
    refetchInterval: 12_000,
    retry: 1
  });
}
