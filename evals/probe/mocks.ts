/**
 * Module overrides shared by the operator entry and the hermetic self-test.
 * Each takes the original module so everything not listed stays real.
 * Wire with `vi.mock(path, async (original) => mocks.xyz(await original()))`.
 */
import { excelStatus, githubStatus, recordCall, rookNodes, runBackend, searchResults } from "./world";

type Module = Record<string, unknown>;

export const db = () => ({ listRookNodesForUser: async () => rookNodes(), createExcelPendingAction: async () => undefined });
export const excelTools = (original: Module) => ({ ...original,
  executeExcelReadTool: async (_user: string, name: string, args: Record<string, unknown>) => runBackend("excel", name, args) });
export const githubTools = (original: Module) => ({ ...original,
  executeGithubReadTool: async (_user: string, name: string, args: Record<string, unknown>) => runBackend("github", name, args) });
export const computerTools = (original: Module) => ({ ...original,
  executeComputerReadTool: async (_user: string, name: string, args: Record<string, unknown>) => runBackend("computer", name, args) });
export const microsoftExcel = (original: Module) => ({ ...original, isMicrosoftExcelConfigured: () => true, microsoftConnectionStatus: async () => excelStatus() });
export const github = (original: Module) => ({ ...original, isGithubConfigured: () => true, githubConnectionStatus: async () => githubStatus() });
export const cloudComputer = (original: Module) => ({ ...original, isCloudComputerConfigured: () => false });
export const webResearch = () => ({ searchPublicWeb: async () => searchResults() });
/** Records every dispatched call (name + parsed args) before the real dispatcher runs. */
export const agentToolExecutor = (original: Module) => ({ ...original,
  executeAgentTool: async (input: { name: string; rawArgs: string }) => {
    recordCall(input.name, input.rawArgs);
    return (original.executeAgentTool as (value: unknown) => Promise<unknown>)(input);
  } });
