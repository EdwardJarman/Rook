// The existing React DOM runtime is used only for hermetic render checks.
// Keep its one used signature local instead of adding a dependency for tests.
declare module "react-dom/server" {
  export function renderToStaticMarkup(node: import("react").ReactNode): string;
}
