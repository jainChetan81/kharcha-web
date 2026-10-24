import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { HoldingForm } from "../components/holding-form";
import { saveFailed, snack } from "../components/sheet";
import { ErrorState, PageHeader, Skeleton } from "../components/ui";
import { getHolding, saveHolding } from "../server/wealth/fns";

export const Route = createFileRoute("/wealth_/$id_/edit")({
  loader: ({ params }) => getHolding({ data: { id: Number(params.id) } }),
  pendingComponent: () => <Skeleton rows={6} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load holding."} retry={() => void router.invalidate()} />; },
  component: EditHolding,
});
function EditHolding() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  if (!data) return <ErrorState text="Holding not found." back="/wealth" backLabel="Back to Wealth" />;
  const save = async (value: Parameters<typeof saveHolding>[0]["data"]) => {
    try {
      await saveHolding({ data: { ...value, id: data.id } });
      snack("Holding saved");
      await navigate({ to: "/wealth/$id", params: { id: String(data.id) } });
    } catch {
      saveFailed(() => void save(value));
    }
  };
  return <>
    <PageHeader title="Edit holding" back="/wealth/$id" backParams={{ id: String(data.id) }} />
    <main className="px-5 pb-8 desk:mx-auto desk:max-w-[640px]">
      <HoldingForm initial={data} onSave={save} />
    </main>
  </>;
}
