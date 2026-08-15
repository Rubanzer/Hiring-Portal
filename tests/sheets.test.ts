import { describe, expect, it } from "vitest";
import { extractSpreadsheetId, hashRow, mapRow } from "../src/lib/sheet-mapping";

/**
 * The row hash is what makes running the webhook and the cron pull simultaneously safe.
 * If it isn't stable, every sync re-imports the sheet; if it isn't unique, leads go missing.
 */

describe("hashRow", () => {
  it("is stable across calls", () => {
    const values = ["Rahul Sharma", "rahul@example.com", "9876543210"];
    expect(hashRow("source-1", values)).toBe(hashRow("source-1", values));
  });

  it("ignores trailing blank cells, which Sheets pads inconsistently", () => {
    const base = ["Rahul", "rahul@example.com"];
    expect(hashRow("source-1", base)).toBe(hashRow("source-1", [...base, "", "", ""]));
  });

  it("ignores case and surrounding whitespace", () => {
    expect(hashRow("source-1", ["Rahul", "RAHUL@Example.com "])).toBe(
      hashRow("source-1", ["rahul", " rahul@example.com"]),
    );
  });

  it("distinguishes different rows and different sources", () => {
    expect(hashRow("source-1", ["Rahul"])).not.toBe(hashRow("source-1", ["Priya"]));
    // The same row in two sheets is two leads, not one.
    expect(hashRow("source-1", ["Rahul"])).not.toBe(hashRow("source-2", ["Rahul"]));
  });

  it("does not collide when field boundaries shift", () => {
    // A naive join("") would make ["ab","c"] and ["a","bc"] identical.
    expect(hashRow("s", ["ab", "c"])).not.toBe(hashRow("s", ["a", "bc"]));
  });
});

describe("mapRow", () => {
  const headers = ["Timestamp", "Your name", "Email address", "Contact No.", "Unmapped"];

  const mapping = {
    "Your name": "fullName" as const,
    "Email address": "email" as const,
    "Contact No.": "phone" as const,
  };

  it("maps only the columns that have a mapping", () => {
    const values = ["2026-01-01", "Rahul Sharma", "rahul@example.com", "9876543210", "junk"];
    expect(mapRow(headers, values, mapping)).toEqual({
      fullName: "Rahul Sharma",
      email: "rahul@example.com",
      phone: "9876543210",
    });
  });

  it("omits blank cells rather than storing empty strings", () => {
    const values = ["2026-01-01", "Rahul Sharma", "  ", "", ""];
    expect(mapRow(headers, values, mapping)).toEqual({ fullName: "Rahul Sharma" });
  });

  it("tolerates rows shorter than the header", () => {
    expect(mapRow(headers, ["2026-01-01", "Rahul Sharma"], mapping)).toEqual({
      fullName: "Rahul Sharma",
    });
  });
});

describe("extractSpreadsheetId", () => {
  it("pulls the id out of a pasted URL", () => {
    expect(
      extractSpreadsheetId(
        "https://docs.google.com/spreadsheets/d/1AbC-dEfG_hIjKlMnOpQrStUvWxYz/edit#gid=0",
      ),
    ).toBe("1AbC-dEfG_hIjKlMnOpQrStUvWxYz");
  });

  it("passes a bare id straight through", () => {
    expect(extractSpreadsheetId("  1AbC-dEfG_hIjKlMnOpQrStUvWxYz ")).toBe(
      "1AbC-dEfG_hIjKlMnOpQrStUvWxYz",
    );
  });
});
