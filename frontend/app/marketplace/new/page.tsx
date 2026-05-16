import {PublishServiceForm} from "@/components/PublishServiceForm";
import {PageHeader} from "@/components/PageHeader";

export default function NewServicePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="panel">
        <PageHeader
          kicker="Developer console"
          title="Publish monetized API"
          description="Set a service manifest, x402 endpoint hash, and per-unit USDC pricing."
        />
        <PublishServiceForm />
      </div>
    </div>
  );
}
