import { saveWithSnack } from "../components/save-with-snack";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "../components/ui";
import { SeriesForm } from "../components/series-form";
import { snack } from "../components/sheet";
import { saveSeries } from "../server/plan/fns";

export const Route = createFileRoute("/plan/recurring_/new")({ component: NewSeries });
function NewSeries() {
  const navigate = useNavigate();
  const save = saveWithSnack(async (value: Parameters<typeof saveSeries>[0]["data"]) => {
    const id = await saveSeries({ data: value });
    snack("Recurring saved");
    await navigate({ to: "/plan/recurring/$id", params: { id: String(id) } });
  });
  return (
    <>
      <PageHeader title="Add recurring" back="/plan/recurring" />
      <div className="px-5 pb-8 desk:mx-auto desk:max-w-[640px]">
        <SeriesForm onSave={save} />
      </div>
    </>
  );
}
