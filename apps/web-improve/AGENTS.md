# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and the usual starting point for UI work
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Windows Temporary Process Safety

Applies ONLY to temporary process lifecycle operations — Vite preview/dev servers, npm/npx servers, `Start-Process`, `Stop-Process`, `Stop-Job`, `taskkill` and similar cleanup. It does NOT add timeouts to builds, tests, installs, lint, or other ordinary commands.

- Never launch a temporary server with `Start-Process -NoNewWindow` unless you control the entire child process tree. `npm.cmd`/`npx.cmd` spawn `cmd.exe` and `node.exe` children that survive the parent — never assume `Stop-Process -Id $p.Id` stops the whole tree.
- Before stopping anything, identify the exact PID, command line, worktree and port. NEVER kill all `node.exe`, `npm`, or `cmd.exe` processes. Prefer stopping only the children of the server you started; kill a whole tree only when its root PID is verified to belong to the current verification session.
- Every STOP/CLEANUP operation has a hard 5-second cap. If the environment supports tool-level command timeouts, use them for every STOP/CLEANUP call. If a stop does not finish within the cap, skip cleanup, record a warning with the surviving PID/port, and move on — no unbounded retries.
- A `Start-Sleep`, `Wait-Job -Timeout`, or an HTTP probe timeout is NOT a hard timeout for the whole PowerShell command, and no timeout mechanism may be built by spawning another job/process that can itself wait forever.
- Waiting for a server to start and probing HTTP get their own time limits (the 5-second STOP cap does not apply to them). Always probe the actual port from the launch configuration or arguments — never hardcode a different port in HTTP checks. Do not start another server while a port is in use until the owning process is identified.
- Never wait on `Stop-Job`/`Wait-Job` or on long-lived server stdout/stderr without a timeout. Prefer verifiable termination checks over fixed sleeps.
- If the terminal tool cannot guarantee a timeout, do not keep issuing stop commands that may hang: report the surviving PID/port and continue independent work.
- Never modify application code, install dependencies, or change Vite configuration to work around an agent process-management failure.
- When a verification server is optional, prefer SKIPPING it and recording the verification gap over running an unbounded server lifecycle.
