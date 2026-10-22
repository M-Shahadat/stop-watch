import { strict as assert } from "node:assert";
import { test } from "node:test";
import { postgresUrl } from "../src/server/db";

test("accepts an existing SQLAlchemy PostgreSQL URL", () => {
  assert.equal(
    postgresUrl("postgresql+psycopg://user:pass@db.example/app?sslmode=require"),
    "postgresql://user:pass@db.example/app?sslmode=require",
  );
  assert.equal(postgresUrl("postgresql://localhost/app"), "postgresql://localhost/app");
});
