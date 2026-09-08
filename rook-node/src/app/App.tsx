import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";

import { router } from "./router";
import { ThemeProvider } from "./lib/theme";
import { ThemeStyle } from "./lib/theme-style";
import { AuthGate } from "./components/auth-gate";

/**
 * Top-level providers.
 *
 * Theme is always available; Clerk is only initialised when a publishable
 * key is set. The AuthGate swaps in a sign-in screen until the user is
 * signed in.
 */
export function App() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
    [],
  );

  return (
    <ThemeProvider>
      <ThemeStyle />
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
