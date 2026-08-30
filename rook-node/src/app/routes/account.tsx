import { useEffect, useState } from "react";
import { LogOut, Trash2, Download, Mail, Calendar } from "lucide-react";
import { useAuth, useUser } from "@clerk/clerk-react";

import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Pill,
  Spinner,
} from "@/components/primitives";
import { useTheme } from "@/lib/theme";

export function AccountPage() {
  const { tokens } = useTheme();
  const { signOut } = useAuth();
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div style={{ padding: 24 }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <header>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 750,
            letterSpacing: -0.4,
            color: tokens.text,
          }}
        >
          Account
        </h1>
        <p style={{ margin: "6px 0 0", color: tokens.textSoft, fontSize: 13 }}>
          Manage your sign-in, data, and connected devices.
        </p>
      </header>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: tokens.accentSoft,
              color: tokens.accent,
              display: "grid",
              placeItems: "center",
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            {(user?.firstName ?? user?.username ?? user?.emailAddresses[0]?.emailAddress ?? "R")
              .slice(0, 1)
              .toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: tokens.text,
                letterSpacing: -0.2,
              }}
            >
              {user?.fullName ?? user?.username ?? "Rook user"}
            </div>
            <div style={{ fontSize: 13, color: tokens.textSoft, display: "flex", alignItems: "center", gap: 6 }}>
              <Mail size={13} /> {user?.emailAddresses[0]?.emailAddress ?? "—"}
            </div>
            <div style={{ fontSize: 12, color: tokens.textFaint, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <Calendar size={12} /> Joined {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
            </div>
          </div>
          <Pill label="Active" tone="mint" />
        </div>
      </Card>

      <Card>
        <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Data</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12.5, color: tokens.textSoft, lineHeight: 1.5 }}>
          Export everything Rook has stored for you, or permanently delete
          your account and data.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary">
            <Download size={14} /> Export data
          </Button>
          <Button variant="danger">
            <Trash2 size={14} /> Delete account
          </Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Session</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12.5, color: tokens.textSoft, lineHeight: 1.5 }}>
          Sign out of this computer. Your data stays in the cloud; Rook will
          close the workroom until you sign in again.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void signOut({ redirectUrl: "/sign-in" });
          }}
        >
          <LogOut size={14} /> Sign out
        </Button>
      </Card>
    </div>
  );
}
