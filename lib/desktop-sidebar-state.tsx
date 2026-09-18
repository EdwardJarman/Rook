import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type DesktopSidebarState = {
  visible: boolean;
  show: () => void;
  hide: () => void;
};

const DesktopSidebarContext = createContext<DesktopSidebarState | undefined>(
  undefined,
);

export function DesktopSidebarProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  const value = useMemo<DesktopSidebarState>(
    () => ({
      visible,
      show: () => setVisible(true),
      hide: () => setVisible(false),
    }),
    [visible],
  );
  return (
    <DesktopSidebarContext.Provider value={value}>
      {children}
    </DesktopSidebarContext.Provider>
  );
}

export function useDesktopSidebar() {
  const state = useContext(DesktopSidebarContext);
  if (!state)
    throw new Error(
      "useDesktopSidebar must be used within DesktopSidebarProvider",
    );
  return state;
}
