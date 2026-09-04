import { createHashRouter, Navigate } from "react-router-dom";

import { AppShell } from "@/components/shell";
import { WorkroomPage } from "@/routes/workroom";
import { BotsPage } from "@/routes/bots";
import { LibraryPage } from "@/routes/library";
import { FilesPage } from "@/routes/files";
import { ComputerPage } from "@/routes/computer";
import { ApprovalsPage } from "@/routes/approvals";
import { AccountPage } from "@/routes/account";
import { SettingsPage } from "@/routes/settings";

export const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <WorkroomPage /> },
      { path: "bots", element: <BotsPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "files", element: <FilesPage /> },
      { path: "computer", element: <ComputerPage /> },
      { path: "approvals", element: <ApprovalsPage /> },
      { path: "account", element: <AccountPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
