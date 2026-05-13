import { createFileRoute } from "@tanstack/react-router";
import { Workspace, Section, KV } from "@/components/pm/Workspace";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Inställningar · Pricematch Control" }] }),
  component: SettingsView,
});

function SettingsView() {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "(samma origin)";
  return (
    <Workspace
      title="Inställningar"
      main={
        <div className="max-w-2xl">
          <Section title="Backend">
            <KV k="API base URL" v={<span className="font-mono">{base}</span>} />
            <div className="mt-2 text-[11px] text-muted-foreground">
              Sätt <span className="font-mono">VITE_API_BASE_URL</span> för att peka frontend mot
              en annan backend. Frontenden anropar endast publika endpoints —
              Shopify-credentials hanteras i backend.
            </div>
          </Section>
          <Section title="Säkerhet">
            <div className="text-[12px] text-muted-foreground">
              Inga Shopify-anrop sker från denna klient. Client Secret exponeras aldrig i frontend.
            </div>
          </Section>
        </div>
      }
    />
  );
}
