import { describe, expect, it } from "vitest";

import { finalAgentText } from "../server/integrations/excel-agent";

describe("agent runtime policy", () => {
  it("never trusts a model to report an approval-gated action as complete", () => {
    expect(finalAgentText("Done. wrote test.txt", [{
      actionId: "command-1",
      title: "Approve computer action",
      detail: "Write test.txt",
      risk: "Medium",
      kind: "cloud",
    }])).toBe(
      "I've prepared this action and it is waiting for your approval here in the chat.",
    );
  });

  it("keeps a normal provider answer when no approval is pending", () => {
    expect(finalAgentText("The file is ready.", [])).toBe("The file is ready.");
  });
});
