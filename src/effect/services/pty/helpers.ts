/**
 * Helper functions for PTY service
 * Platform-specific utilities for process inspection
 */

import { Effect } from "effect"
import { PtyCwdError } from "../../errors"
import { PtyId } from "../../types"

/**
 * Get the foreground process name for a PTY's shell
 * Uses platform-specific commands to determine the active process
 */
export const getForegroundProcess = (shellPid: number): Effect.Effect<string | undefined> =>
  Effect.tryPromise({
    try: async () => {
      const platform = process.platform

      if (platform === "darwin") {
        return await getDarwinForegroundProcess(shellPid)
      } else if (platform === "linux") {
        return await getLinuxForegroundProcess(shellPid)
      }

      return undefined
    },
    catch: () => undefined as string | undefined,
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

/**
 * Get foreground process on macOS using pgrep and ps
 */
async function getDarwinForegroundProcess(shellPid: number): Promise<string | undefined> {
  // Get child processes of the shell
  const pgrepProc = Bun.spawn(
    ["pgrep", "-P", String(shellPid)],
    { stdout: "pipe", stderr: "pipe" }
  )
  const pgrepOutput = await new Response(pgrepProc.stdout).text()
  await pgrepProc.exited

  const childPids = pgrepOutput.trim().split("\n").filter(Boolean)
  if (childPids.length === 0) {
    // No child processes, return the shell name
    const psProc = Bun.spawn(
      ["ps", "-o", "comm=", "-p", String(shellPid)],
      { stdout: "pipe", stderr: "pipe" }
    )
    const name = (await new Response(psProc.stdout).text()).trim()
    await psProc.exited
    // Get just the basename
    return name.split("/").pop() || undefined
  }

  // Get the most recent child's name (likely the foreground process)
  const lastPid = childPids[childPids.length - 1]
  const psProc = Bun.spawn(
    ["ps", "-o", "comm=", "-p", lastPid],
    { stdout: "pipe", stderr: "pipe" }
  )
  const name = (await new Response(psProc.stdout).text()).trim()
  await psProc.exited
  // Get just the basename
  return name.split("/").pop() || undefined
}

/**
 * Get foreground process on Linux using /proc filesystem
 */
async function getLinuxForegroundProcess(shellPid: number): Promise<string | undefined> {
  const statProc = Bun.spawn(
    ["cat", `/proc/${shellPid}/stat`],
    { stdout: "pipe", stderr: "pipe" }
  )
  const statOutput = await new Response(statProc.stdout).text()
  await statProc.exited

  // Parse the stat file to get the process group ID
  const parts = statOutput.split(" ")
  const pgrp = parts[4] // Process group ID

  // Find the process leading the group
  const psProc = Bun.spawn(
    ["ps", "-o", "comm=", "--pid", pgrp],
    { stdout: "pipe", stderr: "pipe" }
  )
  const name = (await new Response(psProc.stdout).text()).trim()
  await psProc.exited
  return name.split("/").pop() || undefined
}

/**
 * Get the git branch for a directory
 */
export const getGitBranch = (cwd: string): Effect.Effect<string | undefined> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        { stdout: "pipe", stderr: "pipe", cwd }
      )
      const output = await new Response(proc.stdout).text()
      const exitCode = await proc.exited
      if (exitCode !== 0) return undefined
      const branch = output.trim()
      return branch || undefined
    },
    catch: () => undefined as string | undefined,
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

/**
 * Get the current working directory of a process by PID
 * Uses platform-specific methods
 */
export const getProcessCwd = (pid: number): Effect.Effect<string, PtyCwdError> =>
  Effect.tryPromise({
    try: async () => {
      const platform = process.platform

      if (platform === "darwin") {
        return await getDarwinProcessCwd(pid)
      } else if (platform === "linux") {
        return await getLinuxProcessCwd(pid)
      }

      throw new Error(`Unsupported platform: ${platform}`)
    },
    catch: (error) =>
      PtyCwdError.make({
        ptyId: PtyId.make(`pid-${pid}`),
        cause: error,
      }),
  })

/**
 * Get process CWD on macOS using lsof
 */
async function getDarwinProcessCwd(pid: number): Promise<string> {
  const proc = Bun.spawn(
    ["lsof", "-a", "-d", "cwd", "-p", String(pid), "-Fn"],
    { stdout: "pipe", stderr: "pipe" }
  )
  const output = await new Response(proc.stdout).text()
  await proc.exited

  const lines = output.split("\n")
  for (const line of lines) {
    if (line.startsWith("n/")) {
      return line.slice(1)
    }
  }
  throw new Error("Could not parse lsof output")
}

/**
 * Get process CWD on Linux using /proc filesystem
 */
async function getLinuxProcessCwd(pid: number): Promise<string> {
  const proc = Bun.spawn(["readlink", "-f", `/proc/${pid}/cwd`], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(proc.stdout).text()
  await proc.exited
  const result = output.trim()
  if (!result) throw new Error("Empty readlink result")
  return result
}
