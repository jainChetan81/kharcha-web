import { saveWithSnack } from "../components/save-with-snack";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HoldingForm } from "../components/holding-form";
import { snack } from "../components/sheet";
import { PageHeader } from "../components/ui";
import { saveHolding } from "../server/wealth/fns";

export const Route = createFileRoute("/wealth_/new")({ component: NewHolding });
function NewHolding() {
  const navigate = useNavigate();
  const save = saveWithSnack(async (value: Parameters<typeof saveHolding>[0]["data"]) => {
    const id = await saveHolding({ data: value });
    snack("Holding saved");
    await navigate({ to: "/wealth/$id", params: { id: String(id) } });
  });
  return (
    <>
      <PageHeader title="Add holding" back="/wealth" />
      <div className="px-5 pb-8 desk:mx-auto desk:max-w-[640px]">
        <HoldingForm onSave={save} />
      </div>
    </>
  );
}
