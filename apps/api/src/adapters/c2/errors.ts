export class C2UnavailableError extends Error {
  constructor(message = "The C2 bridge is unavailable or returned an invalid response.") {
    super(message);
    this.name = "C2UnavailableError";
  }
}

export class C2RejectedError extends Error {
  constructor(
    public readonly status: number,
    message = "The C2 bridge rejected the request.",
  ) {
    super(message);
    this.name = "C2RejectedError";
  }
}
