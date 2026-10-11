import pino from "pino";

const isTest = process.env.NODE_ENV === "test";
const defaultLogLevel = process.env.LOG_LEVEL || (isTest ? "silent" : "info");

export const REDACTED_KEYS = [
  "password",
  "authorization",
  "cookie",
  "token",
  "*.password",
  "*.token",
  "*.authorization",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const createLogger = (
  options?: pino.LoggerOptions,
  destination?: pino.DestinationStream
): pino.Logger => {
  return pino(
    {
      level: defaultLogLevel,
      redact: {
        paths: REDACTED_KEYS,
        censor: "[REDACTED]",
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...options,
    },
    destination
  );
};

export const logger: pino.Logger = createLogger();
