import { z } from "zod";

import type { Tool } from "../_core/llm";
import {
  createExcelWorkbook,
  executeExcelWrite,
  listExcelTables,
  listExcelWorkbooks,
  listExcelWorksheets,
  readExcelRange,
  type ExcelWriteToolName,
} from "./microsoft-excel";

const workbookIdentity = {
  drive_id: z.string().min(1).max(255),
  item_id: z.string().min(1).max(255),
};
const accountIdentity = { account_id: z.string().min(1).max(80).optional() };
const cell = z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]);
const matrix = z.array(z.array(cell).min(1).max(50)).min(1).max(100);

const schemas = {
  excel_list_workbooks: z.object({ ...accountIdentity }),
  excel_list_worksheets: z.object({ ...workbookIdentity, ...accountIdentity }),
  excel_list_tables: z.object({ ...workbookIdentity, ...accountIdentity }),
  excel_read_range: z.object({
    ...workbookIdentity,
    ...accountIdentity,
    worksheet: z.string().min(1).max(31),
    address: z.string().min(2).max(40),
  }),
  excel_update_range: z.object({
    ...workbookIdentity,
    ...accountIdentity,
    workbook_name: z.string().min(1).max(255),
    worksheet: z.string().min(1).max(31),
    address: z.string().min(2).max(40),
    values: matrix.optional(),
    formulas: matrix.optional(),
  }).refine((value) => value.values || value.formulas, "Values or formulas are required"),
  excel_append_table_rows: z.object({
    ...workbookIdentity,
    ...accountIdentity,
    workbook_name: z.string().min(1).max(255),
    table_name: z.string().min(1).max(255),
    values: matrix,
  }),
  excel_add_worksheet: z.object({
    ...workbookIdentity,
    ...accountIdentity,
    workbook_name: z.string().min(1).max(255),
    name: z.string().min(1).max(31),
  }),
  excel_create_workbook: z.object({
    ...accountIdentity,
    name: z.string().min(1).max(120),
    worksheet: z.string().min(1).max(31).optional(),
  }),
} as const;

export type ExcelToolName = keyof typeof schemas;
export const EXCEL_WRITE_TOOL_NAMES = new Set<ExcelToolName>([
  "excel_update_range",
  "excel_append_table_rows",
  "excel_add_worksheet",
  "excel_create_workbook",
]);

const workbookParameters = {
  drive_id: { type: "string", description: "The drive ID returned by excel_list_workbooks." },
  item_id: { type: "string", description: "The workbook item ID returned by excel_list_workbooks." },
};
const accountParameter = {
  account_id: {
    type: "string",
    description: "Optional. The Microsoft account to use when the user has connected more than one. Defaults to their primary account.",
  },
};
const cellSchema = { type: ["string", "number", "boolean", "null"] };
const matrixSchema = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: { type: "array", minItems: 1, maxItems: 50, items: cellSchema },
};

export const EXCEL_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "excel_list_workbooks",
      description: "List the user's Excel .xlsx workbooks in Microsoft OneDrive, including stable drive and item IDs. Use this before workbook-specific tools.",
      parameters: { type: "object", properties: { ...accountParameter }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "excel_list_worksheets",
      description: "List the worksheets in one Excel workbook.",
      parameters: { type: "object", properties: { ...workbookParameters, ...accountParameter }, required: ["drive_id", "item_id"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "excel_list_tables",
      description: "List the named Excel tables in one workbook.",
      parameters: { type: "object", properties: { ...workbookParameters, ...accountParameter }, required: ["drive_id", "item_id"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "excel_read_range",
      description: "Read values, displayed text, and formulas from a worksheet range. Keep the requested range focused and below 2,500 cells.",
      parameters: {
        type: "object",
        properties: {
          ...workbookParameters,
          ...accountParameter,
          worksheet: { type: "string", description: "Exact worksheet name." },
          address: { type: "string", description: "A1 range such as A1:F20." },
        },
        required: ["drive_id", "item_id", "worksheet", "address"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "excel_update_range",
      description: "Prepare an approval-gated update to values or formulas in an exact worksheet range. This never executes without user approval.",
      parameters: {
        type: "object",
        properties: {
          ...workbookParameters,
          ...accountParameter,
          workbook_name: { type: "string" },
          worksheet: { type: "string" },
          address: { type: "string" },
          values: matrixSchema,
          formulas: matrixSchema,
        },
        required: ["drive_id", "item_id", "workbook_name", "worksheet", "address"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "excel_append_table_rows",
      description: "Prepare approval-gated rows to append to a named Excel table. This never executes without user approval.",
      parameters: {
        type: "object",
        properties: { ...workbookParameters, ...accountParameter, workbook_name: { type: "string" }, table_name: { type: "string" }, values: matrixSchema },
        required: ["drive_id", "item_id", "workbook_name", "table_name", "values"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "excel_add_worksheet",
      description: "Prepare an approval-gated addition of a worksheet to an existing workbook.",
      parameters: {
        type: "object",
        properties: { ...workbookParameters, ...accountParameter, workbook_name: { type: "string" }, name: { type: "string" } },
        required: ["drive_id", "item_id", "workbook_name", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "excel_create_workbook",
      description: "Prepare creation of a new .xlsx workbook in the user's OneDrive. Requires approval.",
      parameters: {
        type: "object",
        properties: { ...accountParameter, name: { type: "string" }, worksheet: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
];

export function parseExcelToolArguments(name: string, raw: string | Record<string, unknown>) {
  if (!(name in schemas)) throw new Error(`Unknown Excel tool: ${name}`);
  const input = typeof raw === "string" ? JSON.parse(raw || "{}") as unknown : raw;
  return schemas[name as ExcelToolName].parse(input) as Record<string, unknown>;
}

export async function executeExcelReadTool(userId: string, name: ExcelToolName, args: Record<string, unknown>) {
  const accountId = args.account_id as string | undefined;
  switch (name) {
    case "excel_list_workbooks":
      return listExcelWorkbooks(userId, accountId);
    case "excel_list_worksheets":
      return listExcelWorksheets(userId, args.drive_id as string, args.item_id as string, accountId);
    case "excel_list_tables":
      return listExcelTables(userId, args.drive_id as string, args.item_id as string, accountId);
    case "excel_read_range":
      return readExcelRange(userId, {
        driveId: args.drive_id as string,
        itemId: args.item_id as string,
        worksheet: args.worksheet as string,
        address: args.address as string,
        accountId,
      });
    default:
      throw new Error(`${name} is not a read tool`);
  }
}

export function excelWriteSummary(name: ExcelToolName, args: Record<string, unknown>) {
  switch (name) {
    case "excel_update_range":
      return `Update ${String(args.workbook_name)} · ${String(args.worksheet)}!${String(args.address)} with ${Array.isArray(args.values) ? args.values.length : Array.isArray(args.formulas) ? args.formulas.length : 0} row(s).`;
    case "excel_append_table_rows":
      return `Append ${Array.isArray(args.values) ? args.values.length : 0} row(s) to ${String(args.table_name)} in ${String(args.workbook_name)}.`;
    case "excel_add_worksheet":
      return `Add worksheet “${String(args.name)}” to ${String(args.workbook_name)}.`;
    case "excel_create_workbook":
      return `Create “${String(args.name).replace(/\.xlsx$/i, "")}.xlsx” in OneDrive.`;
    default:
      throw new Error(`${name} is not a write tool`);
  }
}

export async function executeValidatedExcelWrite(userId: string, name: ExcelToolName, args: Record<string, unknown>) {
  const parsed = schemas[name].parse(args) as Record<string, unknown>;
  const normalized = {
    driveId: parsed.drive_id,
    itemId: parsed.item_id,
    worksheet: parsed.worksheet,
    address: parsed.address,
    values: parsed.values,
    formulas: parsed.formulas,
    tableName: parsed.table_name,
    name: parsed.name,
    accountId: parsed.account_id,
  } as Record<string, unknown>;
  return executeExcelWrite(userId, name as ExcelWriteToolName, normalized);
}

// Retain a direct export for UI-created workbooks without duplicating validation logic.
export { createExcelWorkbook };
