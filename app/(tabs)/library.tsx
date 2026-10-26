import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  Card,
  EmptyState,
  Field,
  PrimaryButton,
  ScreenHeader,
  SegmentedControl,
  Sheet,
  SheetEyebrow,
  StatusPill,
  Switch,
  useRookTheme,
} from "@/components/rook-primitives";
import { ScreenContainer } from "@/components/screen-container";
import { useDockScroll } from "@/lib/dock-visibility";
import { useRookNotifications } from "@/lib/rook-notifications";
import { useWorkroom } from "@/lib/workroom-store";

type LibrarySection = "Skills" | "Routines" | "Files" | "Search" | "Privacy";
const SECTIONS = ["Skills", "Routines", "Files", "Search", "Privacy"] as const;

export default function LibraryScreen() {
  const { colors } = useRookTheme();
  const { skills, routines, files, bots, addSkill, addRoutine, toggleRoutine } = useWorkroom();
  const { status: notificationStatus, preferences: notificationPreferences, enableAlerts, setPreference } = useRookNotifications();
  const [section, setSection] = useState<LibrarySection>("Skills");
  const [skillOpen, setSkillOpen] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [routineName, setRoutineName] = useState("");
  const [routineCadence, setRoutineCadence] = useState("");
  const [search, setSearch] = useState("");
  const dockScroll = useDockScroll();

  const requireBot = () => {
    if (bots.length) return true;
    Alert.alert("Create a Bot first", "Skills and routines need a Bot owner. Create one from the Workroom or Bots, then return here.");
    return false;
  };

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return [
      ...bots
        .filter((item) => `${item.name} ${item.role} ${item.purpose}`.toLowerCase().includes(query))
        .map((item) => ({ type: "Bot", title: item.name, detail: item.role })),
      ...skills
        .filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query))
        .map((item) => ({ type: "Skill", title: item.name, detail: item.description })),
      ...routines
        .filter((item) => `${item.name} ${item.summary}`.toLowerCase().includes(query))
        .map((item) => ({ type: "Routine", title: item.name, detail: item.cadence })),
      ...files
        .filter((item) => `${item.name} ${item.owner}`.toLowerCase().includes(query))
        .map((item) => ({ type: "File", title: item.name, detail: `${item.scope} · ${item.owner}` })),
    ];
  }, [bots, files, routines, search, skills]);

  const createSkill = () => {
    if (!requireBot()) return;
    if (!skillName.trim() || !skillDescription.trim()) {
      Alert.alert("Finish the skill", "Give the process a name and describe what it should do.");
      return;
    }
    addSkill({
      name: skillName.trim(),
      owner: bots[0].name,
      status: "Draft",
      description: skillDescription.trim(),
      version: "v0.1",
      approvals: "Review the approval boundary before enabling",
    });
    setSkillName("");
    setSkillDescription("");
    setSkillOpen(false);
  };

  const createRoutine = () => {
    if (!requireBot()) return;
    if (!routineName.trim() || !routineCadence.trim()) {
      Alert.alert("Finish the routine", "Give it a name and tell Rook when it should run.");
      return;
    }
    addRoutine({
      name: routineName.trim(),
      owner: bots[0].name,
      cadence: routineCadence.trim(),
      nextRun: "Paused until enabled",
      state: "Paused",
      summary: "Review the inputs and approval boundary before enabling this routine.",
    });
    setRoutineName("");
    setRoutineCadence("");
    setRoutineOpen(false);
    setSection("Routines");
  };

  const titleMeta: Record<LibrarySection, { lead: string; actionLabel: string }> = {
    Skills: { lead: "Reusable processes saved from real work.", actionLabel: "New skill" },
    Routines: { lead: "Work that repeats on your cadence.", actionLabel: "New routine" },
    Files: { lead: "Everything your Bots can reference.", actionLabel: "" },
    Search: { lead: "Find anything across your workroom.", actionLabel: "" },
    Privacy: { lead: "Storage and alert controls, in plain language.", actionLabel: "" },
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1" edges={["top", "left", "right"]}>
      <ScrollView
        {...dockScroll}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 34, gap: 20, maxWidth: 720, width: "100%", alignSelf: "center" }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          title="Library"
          lead={titleMeta[section].lead}
          action={
            section === "Skills" || section === "Routines" ? (
              <PrimaryButton
                label={section === "Skills" ? "New skill" : "New routine"}
                icon="add"
                onPress={() => (section === "Skills" ? requireBot() && setSkillOpen(true) : requireBot() && setRoutineOpen(true))}
              />
            ) : undefined
          }
        />

        <SegmentedControl options={SECTIONS} selected={section} onSelect={setSection} />

        {section === "Skills" ? (
          skills.length ? (
            <View style={{ gap: 10 }}>
              {skills.map((skill) => (
                <Card key={skill.id}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.1 }}>{skill.name}</Text>
                      <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 3 }}>
                        {skill.owner} · {skill.version}
                      </Text>
                    </View>
                    <StatusPill label={skill.status} tone={skill.status === "Enabled" ? "mint" : "muted"} />
                  </View>
                  <Text style={{ color: colors.textSoft, fontSize: 13, lineHeight: 19 }}>{skill.description}</Text>
                  <Text style={{ color: colors.textFaint, fontSize: 11.5, lineHeight: 16 }}>{skill.approvals}</Text>
                </Card>
              ))}
            </View>
          ) : (
            <EmptyState icon="bolt" title="No skills yet" detail="Finish a task worth repeating, then save it as a skill from the result." />
          )
        ) : null}

        {section === "Routines" ? (
          routines.length ? (
            <View style={{ gap: 10 }}>
              {routines.map((routine) => (
                <Card key={routine.id}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.1 }}>{routine.name}</Text>
                      <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 3 }}>
                        {routine.owner} · {routine.cadence}
                      </Text>
                    </View>
                    <StatusPill label={routine.state} tone={routine.state === "Active" ? "mint" : "muted"} />
                  </View>
                  <Text style={{ color: colors.textSoft, fontSize: 13, lineHeight: 19 }}>{routine.summary}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>{routine.nextRun}</Text>
                    <Switch
                      accessibilityLabel={`${routine.state === "Active" ? "Pause" : "Resume"} routine ${routine.name}`}
                      checked={routine.state === "Active"}
                      onToggle={() => toggleRoutine(routine.id)}
                    />
                  </View>
                </Card>
              ))}
            </View>
          ) : (
            <EmptyState icon="schedule" title="No routines yet" detail="Create a routine only after you have a Bot and a repeatable way of working." />
          )
        ) : null}

        {section === "Files" ? (
          files.length ? (
            <View style={{ gap: 10 }}>
              {files.map((file) => (
                <Card key={file.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 13,
                      backgroundColor: colors.surfaceAlt,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <MaterialIcons name={file.name.endsWith(".pdf") ? "picture-as-pdf" : "description"} size={19} color={colors.textSoft} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
                      {file.name}
                    </Text>
                    <Text style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 2 }}>
                      {file.size} · {file.owner}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                    <Text style={{ color: colors.textSoft, fontSize: 10.5, fontWeight: "600" }}>{file.scope}</Text>
                  </View>
                </Card>
              ))}
            </View>
          ) : (
            <EmptyState icon="attach-file" title="No files yet" detail="Attach a file from a Bot conversation when it is useful to the work." />
          )
        ) : null}

        {section === "Search" ? (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 16,
                paddingHorizontal: 14,
              }}
            >
              <MaterialIcons name="search" size={19} color={colors.textFaint} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search Bots, files, skills, routines"
                placeholderTextColor={colors.placeholder}
                style={{ flex: 1, color: colors.text, fontSize: 15, height: 48 }}
                accessibilityLabel="Search your workroom"
              />
              {search ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")} hitSlop={8}>
                  <MaterialIcons name="close" size={18} color={colors.textFaint} />
                </Pressable>
              ) : null}
            </View>
            {search.trim() ? (
              searchResults.length ? (
                <View style={{ gap: 10 }}>
                  {searchResults.map((item, index) => (
                    <Card key={`${item.type}-${item.title}-${index}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                      <View style={{ backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, minWidth: 52, alignItems: "center" }}>
                        <Text style={{ color: colors.accent, fontSize: 10.5, fontWeight: "700" }}>{item.type}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
                          {item.title}
                        </Text>
                        <Text numberOfLines={1} style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 2 }}>
                          {item.detail}
                        </Text>
                      </View>
                    </Card>
                  ))}
                </View>
              ) : (
                <EmptyState icon="search-off" title="No matching work" detail="Try a Bot name, file, skill, or routine you created." />
              )
            ) : (
              <EmptyState icon="manage-search" title="Search starts here" detail="Your results will appear as you create Bots and add work." />
            )}
          </>
        ) : null}

        {section === "Privacy" ? (
          <>
            <Card>
              <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.1 }}>Workroom storage</Text>
              <Text style={{ color: colors.textSoft, fontSize: 13, lineHeight: 19 }}>
                Your Bots, messages, tasks, and settings live in your authenticated managed cloud workroom, with a local offline fallback on this
                device.
              </Text>
            </Card>
            <Card style={{ gap: 0 }}>
              <PreferenceRow
                title="Approval alerts"
                detail="Decisions that need you"
                checked={notificationPreferences.approval}
                onToggle={() => setPreference("approval", !notificationPreferences.approval)}
              />
              <View style={{ height: 1, backgroundColor: colors.line }} />
              <PreferenceRow
                title="Completion alerts"
                detail="Finished task summaries"
                checked={notificationPreferences.completion}
                onToggle={() => setPreference("completion", !notificationPreferences.completion)}
              />
            </Card>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>Device delivery</Text>
                  <Text style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 2 }}>Status: {notificationStatus}</Text>
                </View>
                <PrimaryButton label="Enable alerts" onPress={() => void enableAlerts()} />
              </View>
            </Card>
          </>
        ) : null}
      </ScrollView>

      {/* New skill */}
      <Sheet visible={skillOpen} onClose={() => setSkillOpen(false)}>
        <SheetEyebrow>New skill</SheetEyebrow>
        <Text style={{ color: colors.text, fontSize: 23, lineHeight: 29, fontWeight: "700", letterSpacing: -0.6 }}>Save a process</Text>
        <Text style={{ color: colors.textSoft, fontSize: 13.5, lineHeight: 19.5, marginTop: 7, marginBottom: 18 }}>
          A skill is a reusable way of working your Bots can follow.
        </Text>
        <View style={{ gap: 14 }}>
          <Field label="Name" value={skillName} onChangeText={setSkillName} placeholder="Weekly source brief" autoFocus />
          <Field
            label="What it does"
            value={skillDescription}
            onChangeText={setSkillDescription}
            placeholder="Gathers the sources I list and returns a one-page brief."
            multiline
          />
        </View>
        <View style={{ marginTop: 24 }}>
          <PrimaryButton label="Save skill" icon="check" onPress={createSkill} />
        </View>
      </Sheet>

      {/* New routine */}
      <Sheet visible={routineOpen} onClose={() => setRoutineOpen(false)}>
        <SheetEyebrow>New routine</SheetEyebrow>
        <Text style={{ color: colors.text, fontSize: 23, lineHeight: 29, fontWeight: "700", letterSpacing: -0.6 }}>Repeat the work</Text>
        <Text style={{ color: colors.textSoft, fontSize: 13.5, lineHeight: 19.5, marginTop: 7, marginBottom: 18 }}>
          A routine runs a skill on a cadence you control.
        </Text>
        <View style={{ gap: 14 }}>
          <Field label="Name" value={routineName} onChangeText={setRoutineName} placeholder="Monday morning brief" autoFocus />
          <Field label="When it runs" value={routineCadence} onChangeText={setRoutineCadence} placeholder="Every Monday at 08:00" />
        </View>
        <View style={{ marginTop: 24 }}>
          <PrimaryButton label="Create routine" icon="check" onPress={createRoutine} />
        </View>
      </Sheet>
    </ScreenContainer>
  );
}

function PreferenceRow({ title, detail, checked, onToggle }: { title: string; detail: string; checked: boolean; onToggle: () => void }) {
  const { colors } = useRookTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>{title}</Text>
        <Text style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 2 }}>{detail}</Text>
      </View>
      <Switch accessibilityLabel={title} checked={checked} onToggle={onToggle} />
    </View>
  );
}
