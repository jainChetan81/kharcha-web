import { createRouter, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { ErrorState, Skeleton } from "./components/ui";
import { routeTree } from "./routeTree.gen";

function RoutePending() {
  return (
    <div className="px-5 desk:px-0">
      <Skeleton rows={6} />
    </div>
  );
}

function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <ErrorState text={error instanceof Error ? error.message : undefined} retry={() => void router.invalidate()} />;
}

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: false,
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
  });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
