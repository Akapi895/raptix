export class RuntimeUnavailableError extends Error {
  constructor(message = "Runtime is unavailable") {
    super(message);
    this.name = "RuntimeUnavailableError";
  }
}

export class RuntimeRejectedError extends Error {
  constructor(
    public readonly status: number,
    message = "Runtime rejected the request",
  ) {
    super(message);
    this.name = "RuntimeRejectedError";
  }
}
