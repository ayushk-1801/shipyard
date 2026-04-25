import { z } from "zod";

export const isValidGitUrl = (value: string | undefined) => {
  if (!value) return false;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (["http:", "https:", "ssh:", "git:"].includes(url.protocol)) return true;
  } catch {
    // Fall through to SCP-style Git URL validation.
  }

  return /^[\w.-]+@[\w.-]+:[\w./-]+(?:\.git)?$/u.test(trimmed);
};

export const createDeploymentSchema = z
  .object({
    sourceType: z.enum(["git", "archive"]),
    gitUrl: z.string().trim().optional(),
    gitRef: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) => (value ? value : undefined)),
    containerPort: z.coerce.number().int().min(1).max(65535).default(3000)
  })
  .superRefine((value, context) => {
    if (value.sourceType === "git") {
      if (!isValidGitUrl(value.gitUrl)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gitUrl"],
          message: "A valid HTTPS or SSH-style Git URL is required."
        });
      }
    }
  });

export type CreateDeploymentFields = z.infer<typeof createDeploymentSchema>;
