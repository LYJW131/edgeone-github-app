import { describe, expect, it } from "vitest";
import { testables as edgeone } from "../src/edgeone";
import { testables as setup } from "../src/setup";

describe("EdgeOne payload parsing", () => {
  it("accepts documented deployment events", () => {
    expect(edgeone.parseEvent(JSON.stringify({
      eventType: "deployment.created",
      projectId: "makers-example",
      deploymentId: "deployment-example",
      projectName: "Example",
      repoBranch: "main",
      timestamp: 1,
    }))).toMatchObject({ projectId: "makers-example", repoBranch: "main" });
  });

  it("rejects unknown events and incomplete payloads", () => {
    expect(edgeone.parseEvent("{}" )).toBeNull();
    expect(edgeone.parseEvent(JSON.stringify({
      eventType: "deployment.deleted",
      projectId: "makers-example",
      deploymentId: "deployment-example",
      repoBranch: "main",
      timestamp: 1,
    }))).toBeNull();
  });

  it("does not regress a terminal deployment to created", () => {
    expect(edgeone.isStaleTerminalTransition("deployment.succeeded", "deployment.created")).toBe(true);
    expect(edgeone.isStaleTerminalTransition("deployment.created", "deployment.succeeded")).toBe(false);
  });
});

describe("setup input parsing", () => {
  it("renders separate copy buttons for the webhook URL and secret", () => {
    const content = setup.connectionCreatedContent(
      "https://example.com/edgeone/hook-id",
      "secret-token",
      "script-nonce",
    );
    expect(content).toContain('data-copy-target="webhookUrl"');
    expect(content).toContain('data-copy-target="secretToken"');
    expect(content).toContain('value="https://example.com/edgeone/hook-id"');
    expect(content).toContain('value="secret-token"');
    expect(content).toContain('<script nonce="script-nonce">');
  });

  it("accepts only positive safe installation IDs", () => {
    expect(setup.parseInstallationId("123")).toBe(123);
    expect(setup.parseInstallationId("0")).toBeNull();
    expect(setup.parseInstallationId("12x")).toBeNull();
  });

  it("rejects empty and control-character text", () => {
    expect(setup.validText(" main ", 20)).toBe("main");
    expect(setup.validText("bad\nbranch", 20)).toBeNull();
  });
});
