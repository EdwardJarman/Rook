import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "../server/integrations/crypto";
import {
  excelWriteSummary,
  parseExcelToolArguments,
} from "../server/integrations/excel-tools";

const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;

describe("integration secret encryption", () => {
  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "test-only-integration-key-that-is-long-enough";
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
  });

  it("round trips a token without storing plaintext", () => {
    const encrypted = encryptSecret("access-token-value");
    expect(encrypted).not.toContain("access-token-value");
    expect(encrypted.startsWith("rook-aes-gcm-v1:")).toBe(true);
    expect(decryptSecret(encrypted)).toBe("access-token-value");
  });

  it("rejects a modified authentication tag", () => {
    const encrypted = encryptSecret("refresh-token-value");
    const parts = encrypted.split(":");
    parts[2] = `${parts[2].startsWith("A") ? "B" : "A"}${parts[2].slice(1)}`;
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});

describe("Excel agent tools", () => {
  it("accepts a focused workbook range", () => {
    expect(parseExcelToolArguments("excel_read_range", {
      drive_id: "drive-1",
      item_id: "item-1",
      worksheet: "Forecast",
      address: "A1:F20",
    })).toMatchObject({ worksheet: "Forecast", address: "A1:F20" });
  });

  it("requires values or formulas for an update", () => {
    expect(() => parseExcelToolArguments("excel_update_range", {
      drive_id: "drive-1",
      item_id: "item-1",
      workbook_name: "Forecast.xlsx",
      worksheet: "Q3",
      address: "B2:C3",
    })).toThrow();
  });

  it("describes the exact workbook write before approval", () => {
    const args = parseExcelToolArguments("excel_update_range", {
      drive_id: "drive-1",
      item_id: "item-1",
      workbook_name: "Forecast.xlsx",
      worksheet: "Q3",
      address: "B2:C3",
      values: [[10, 20], [30, 40]],
    });
    expect(excelWriteSummary("excel_update_range", args)).toBe(
      "Update Forecast.xlsx · Q3!B2:C3 with 2 row(s).",
    );
  });

  it("accepts an optional account_id for multi-account connectors", () => {
    const args = parseExcelToolArguments("excel_list_workbooks", {
      account_id: "msft-abc123",
    });
    expect(args).toMatchObject({ account_id: "msft-abc123" });
  });

  it("defaults to no explicit account when account_id is omitted", () => {
    const args = parseExcelToolArguments("excel_list_workbooks", {});
    expect(args.account_id).toBeUndefined();
  });
});
