import type { InstantRules } from "@instantdb/admin";

const rules = {
  $default: {
    allow: {
      $default: "false",
    },
  },
  attrs: {
    allow: {
      create: "false",
    },
  },
} satisfies InstantRules;

export default rules;
