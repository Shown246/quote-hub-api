export interface ProblemDetailsResponse {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance?: string;
  errors?: Record<string, string[]>;
}

export abstract class AppError extends Error {
  public abstract readonly status: number;
  public abstract readonly code: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly type: string;
  public readonly isAppError = true;

  constructor(
    detail: string,
    title: string = "An error occurred",
    type: string = "about:blank"
  ) {
    super(detail);
    this.name = this.constructor.name;
    this.detail = detail;
    this.title = title;
    this.type = type;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  public readonly status = 400;
  public readonly code = "VALIDATION_ERROR";
  public readonly errors?: Record<string, string[]>;

  constructor(
    detailOrErrors?: string | Record<string, string[]>,
    errorsOrTitle?: Record<string, string[]> | string,
    title?: string
  ) {
    let detail = "Validation failed";
    let resolvedErrors: Record<string, string[]> | undefined;
    let resolvedTitle = "Validation failed";

    if (typeof detailOrErrors === "string") {
      detail = detailOrErrors;
      if (errorsOrTitle && typeof errorsOrTitle === "object") {
        resolvedErrors = errorsOrTitle;
        if (title) resolvedTitle = title;
      } else if (typeof errorsOrTitle === "string") {
        resolvedTitle = errorsOrTitle;
      }
    } else if (detailOrErrors && typeof detailOrErrors === "object") {
      resolvedErrors = detailOrErrors;
      if (typeof errorsOrTitle === "string") {
        resolvedTitle = errorsOrTitle;
      }
    }

    super(detail, resolvedTitle);
    this.errors = resolvedErrors;
  }
}

export class AuthenticationError extends AppError {
  public readonly status = 401;
  public readonly code: string;

  constructor(
    detail: string = "Authentication required",
    code: string = "AUTHENTICATION_ERROR",
    title: string = "Authentication required"
  ) {
    super(detail, title);
    this.code = code;
  }
}

export class AuthorizationError extends AppError {
  public readonly status = 403;
  public readonly code: string;

  constructor(
    detail: string = "Access denied",
    code: string = "AUTHORIZATION_ERROR",
    title: string = "Access denied"
  ) {
    super(detail, title);
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  public readonly status = 404;
  public readonly code = "NOT_FOUND";

  constructor(
    detail: string = "Resource not found",
    title: string = "Resource not found"
  ) {
    super(detail, title);
  }
}

export class ConflictError extends AppError {
  public readonly status = 409;
  public readonly code = "CONFLICT";

  constructor(
    detail: string = "Conflict",
    title: string = "Conflict"
  ) {
    super(detail, title);
  }
}

export class RateLimitError extends AppError {
  public readonly status = 429;
  public readonly code = "RATE_LIMIT_EXCEEDED";

  constructor(
    detail: string = "Too many requests",
    title: string = "Too many requests"
  ) {
    super(detail, title);
  }
}

export function toProblemDetails(
  error: unknown,
  requestId?: string
): ProblemDetailsResponse {
  if (
    error instanceof AppError ||
    (error !== null &&
      typeof error === "object" &&
      (error as { isAppError?: boolean }).isAppError === true)
  ) {
    const appError = error as AppError & { errors?: Record<string, string[]> };
    const problem: ProblemDetailsResponse = {
      type: appError.type || "about:blank",
      title: appError.title,
      status: appError.status,
      detail: appError.detail,
      code: appError.code,
    };

    if (requestId) {
      problem.instance = requestId;
    }

    if (appError.errors !== undefined) {
      problem.errors = appError.errors;
    }

    return problem;
  }

  const problem: ProblemDetailsResponse = {
    type: "about:blank",
    title: "Internal server error",
    status: 500,
    detail: "An unexpected internal error occurred.",
    code: "INTERNAL_SERVER_ERROR",
  };

  if (requestId) {
    problem.instance = requestId;
  }

  return problem;
}
