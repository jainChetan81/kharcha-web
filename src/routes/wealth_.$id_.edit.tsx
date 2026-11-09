import { saveWithSnack } from "../components/save-with-snack";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HoldingForm } from "../components/holding-form";
import { snack } from "../components/sheet";
import { ErrorState, PageHeader } from "../components/ui";
import { getHolding, saveHolding } from "../server/wealth/fns";

export const Route = createFileRoute("/wealth_/$id_/edit")({
  loader: ({ params }) => getHolding({ data: { id: Number(params.id) } }),
  component: EditHolding,
});
function EditHolding() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  if (!data) return <ErrorState text="Holding not found." back="/wealth" backLabel="Back to Wealth" />;
  const save = saveWithSnack(async (value: Parameters<typeof saveHolding>[0]["data"]) => {
    await saveHolding({ data: { ...value, id: data.id } });
    snack("Holding saved");
    await navigate({ to: "/wealth/$id", params: { id: String(data.id) } });
  });
  return (
    <>
      <PageHeader title="Edit holding" back="/wealth/$id" backParams={{ id: String(data.id) }} />
      <div className="px-5 pb-8 desk:mx-auto desk:max-w-[640px]">
        <HoldingForm initial={data} onSave={save} />
      </div>
    </>
  );
}
