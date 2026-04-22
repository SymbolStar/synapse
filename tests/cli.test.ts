import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";

function runCli(...args: string[]) {
	const result = spawnSync("bun", ["run", "src/cli.ts", ...args], {
		cwd: import.meta.dir.replace("/tests", ""),
		timeout: 10000,
	});
	return {
		stdout: result.stdout?.toString() ?? "",
		stderr: result.stderr?.toString() ?? "",
		exitCode: result.status ?? 1,
	};
}

describe("CLI commands", () => {
	test("--help shows usage with new commands", () => {
		const { stdout, exitCode } = runCli("--help");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("search <query>");
		expect(stdout).toContain("sessions");
		expect(stdout).toContain("show <session_id>");
		expect(stdout).toContain("stats");
	});

	test("search without query shows error", () => {
		const { stderr, exitCode } = runCli("search");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("search requires a query");
	});

	test("show without session_id shows error", () => {
		const { stderr, exitCode } = runCli("show");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("show requires a session_id");
	});

	test("stats runs without error", () => {
		const { stdout, exitCode } = runCli("stats");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Sessions:");
		expect(stdout).toContain("Messages:");
		expect(stdout).toContain("DB size:");
	});

	test("sessions runs without error", () => {
		const { stdout, exitCode } = runCli("sessions");
		expect(exitCode).toBe(0);
		// May have 0 sessions, that's fine
	});

	test("search with query runs", () => {
		const { exitCode } = runCli("search", "test");
		expect(exitCode).toBe(0);
	});

	test("show with nonexistent session", () => {
		const { stderr, exitCode } = runCli("show", "nonexistent-id");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Session not found");
	});
});
