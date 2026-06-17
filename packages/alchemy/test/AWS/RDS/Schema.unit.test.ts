import { splitStatements } from "@/AWS/RDS/Schema";
import { describe, expect, test } from "vitest";

describe("splitStatements", () => {
  test("splits drizzle output on statement-breakpoint and strips trailing ;", () => {
    const sql =
      "CREATE TABLE a (id int);\n--> statement-breakpoint\nCREATE TABLE b (id int);\n";
    expect(splitStatements(sql)).toEqual([
      "CREATE TABLE a (id int)",
      "CREATE TABLE b (id int)",
    ]);
  });

  test("falls back to semicolon split when there is no breakpoint", () => {
    const sql = "INSERT INTO a VALUES (1);\nINSERT INTO a VALUES (2);\n";
    expect(splitStatements(sql)).toEqual([
      "INSERT INTO a VALUES (1)",
      "INSERT INTO a VALUES (2)",
    ]);
  });

  test("drops empty trailing chunks", () => {
    const sql = "CREATE TABLE a (id int);\n--> statement-breakpoint\n\n";
    expect(splitStatements(sql)).toEqual(["CREATE TABLE a (id int)"]);
  });
});
