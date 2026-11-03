/** The sandbox could not complete the file operation. The reason stays server-side; the caller gets this only. */
export class SandboxUnavailableError extends Error {
  constructor(message = "The project sandbox could not complete the file operation. Retry when the project sandbox is running.") {
    super(message);
    this.name = "SandboxUnavailableError";
  }
}

export class SandboxInvalidPathError extends Error {
  constructor(message = "Invalid project file path.") {
    super(message);
    this.name = "SandboxInvalidPathError";
  }
}
