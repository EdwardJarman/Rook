import { useState } from "react";
import { Plus, Search, BookOpen, Calendar, ListChecks } from "lucide-react";

import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Pill,
  Segmented,
  Textarea,
} from "@/components/primitives";
import { useTheme } from "@/lib/theme";
import { useWorkroom } from "@/lib/workroom";

type Tab = "skills" | "routines" | "files" | "search";

export function LibraryPage() {
  const { tokens } = useTheme();
  const { skills, routines } = useWorkroom();
  const [tab, setTab] = useState<Tab>("skills");
  const [query, setQuery] = useState("");

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 750,
            letterSpacing: -0.4,
            color: tokens.text,
          }}
        >
          Library
        </h1>
        <Pill label={`${skills.length + routines.length}`} tone="muted" />
        <div style={{ flex: 1 }} />
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "skills", label: "Skills" },
            { value: "routines", label: "Routines" },
            { value: "files", label: "Files" },
            { value: "search", label: "Search" },
          ]}
        />
      </header>

      {tab === "skills" ? (
        <SkillsPanel query={query} setQuery={setQuery} />
      ) : tab === "routines" ? (
        <RoutinesPanel />
      ) : tab === "files" ? (
        <FilesPanel query={query} setQuery={setQuery} />
      ) : (
        <SearchPanel query={query} setQuery={setQuery} />
      )}
    </div>
  );
}

function SkillsPanel({ query, setQuery }: { query: string; setQuery: (q: string) => void }) {
  const { tokens } = useTheme();
  const { skills } = useWorkroom();
  const filtered = skills.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SearchBar value={query} onChange={setQuery} placeholder="Search skills…" />
      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={18} />}
          title="No skills yet"
          body="Save a process from a finished task to reuse it later."
          action={<Button>Save a skill</Button>}
        />
      ) : (
        filtered.map((skill) => (
          <Card key={skill.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 700,
                    color: tokens.text,
                  }}
                >
                  {skill.name}
                </div>
                <div style={{ fontSize: 12.5, color: tokens.textSoft }}>
                  {skill.description}
                </div>
              </div>
              <Pill
                label={skill.status}
                tone={
                  skill.status === "Enabled"
                    ? "mint"
                    : skill.status === "Testing"
                      ? "amber"
                      : "muted"
                }
              />
              <span style={{ fontSize: 12, color: tokens.textFaint }}>
                v{skill.version}
              </span>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function RoutinesPanel() {
  const { tokens } = useTheme();
  const { routines } = useWorkroom();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {routines.length === 0 ? (
        <EmptyState
          icon={<Calendar size={18} />}
          title="No routines yet"
          body="Turn a task into a recurring job. Routines run on a schedule and pause for approval when risk is high."
          action={<Button>Create routine</Button>}
        />
      ) : (
        routines.map((r) => (
          <Card key={r.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 700,
                    color: tokens.text,
                  }}
                >
                  {r.name}
                </div>
                <div style={{ fontSize: 12.5, color: tokens.textSoft }}>
                  {r.schedule}
                </div>
              </div>
              <Pill
                label={r.status}
                tone={r.status === "Active" ? "mint" : "muted"}
              />
              <span style={{ fontSize: 12, color: tokens.textFaint }}>
                Next: {r.nextRun}
              </span>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function FilesPanel({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (q: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SearchBar value={query} onChange={setQuery} placeholder="Search files…" />
      <EmptyState
        icon={<ListChecks size={18} />}
        title="Cloud files live in the Files tab"
        body="Use the Files tab to browse your cloud files and the local folders you've linked to this computer."
        action={<Button>Open Files</Button>}
      />
    </div>
  );
}

function SearchPanel({ query, setQuery }: { query: string; setQuery: (q: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SearchBar value={query} onChange={setQuery} placeholder="Search Bots, skills, files…" />
      <EmptyState
        icon={<Search size={18} />}
        title="Search your workroom"
        body="Find anything in your Bots, skills, routines, files, and approvals. Type to begin."
      />
    </div>
  );
}

function SearchBar({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: tokens.surface,
        border: `1px solid ${tokens.line}`,
        borderRadius: 12,
        padding: "8px 12px",
      }}
    >
      <Search size={14} color={tokens.textFaint} />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          border: "none",
          padding: 0,
          background: "transparent",
        }}
      />
    </div>
  );
}
