import {useArcName} from "@/hooks/useArcName";
import {shortAddress} from "@/lib/arc";

type Props = {
  address?: string | null;
  fallback?: string;
  showLoading?: boolean;
};

export function ArcNameLabel({address, fallback = "operator", showLoading = true}: Props) {
  const {arcName, isLoading} = useArcName(address);

  if (arcName) return <span>{arcName}</span>;
  if (isLoading && showLoading) return <span>Resolving .arc...</span>;
  if (!address) return <span>{fallback}</span>;

  return <span>{shortAddress(address)}</span>;
}
