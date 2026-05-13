import { createFileRoute } from "@tanstack/react-router";
import { SUPPORTED_SCRAPERS } from "@/lib/api";
import { Workspace } from "@/components/pm/Workspace";
import { Tone } from "@/components/pm/StatusPill";

export const Route = createFileRoute("/scrapers")({
  head: () => ({ meta: [{ title: "Scraper-status · Pricematch Control" }] }),
  component: ScrapersView,
});

function ScrapersView() {
  return (
    <Workspace
      title="Scraper-status"
      subtitle={`${SUPPORTED_SCRAPERS.length} domäner med stöd`}
      main={
        <div>
          <div className="border-b border-border px-5 py-3 text-[12px] text-muted-foreground">
            Domäner som backend har scraper-stöd för. Andra domäner kan läggas till som länkar
            men kommer inte att hämtas.
          </div>
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2 text-left text-[10px] uppercase tracking-wider text-subtle">
              <tr>
                <th className="border-b border-border px-5 py-2">Domän</th>
                <th className="border-b border-border px-5 py-2">Stöd</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_SCRAPERS.map((d) => (
                <tr key={d} className="border-b border-border hover:bg-muted">
                  <td className="px-5 py-2 font-mono">{d}</td>
                  <td className="px-5 py-2">
                    <Tone tone="ok">aktiv</Tone>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}
