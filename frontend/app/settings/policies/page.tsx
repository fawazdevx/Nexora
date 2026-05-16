import {PolicyForm} from "@/components/PolicyForm";
import {PageHeader} from "@/components/PageHeader";

export default function PoliciesPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <section className="panel">
        <PageHeader
          kicker="Agent controls"
          title="Wallet policy cockpit"
          description="Set daily spend limits, transaction caps, and autonomous payment controls."
        />
        <PolicyForm />
      </section>
    </div>
  );
}
