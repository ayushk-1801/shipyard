import { z } from "zod";

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
      const parsed = z.string().url().safeParse(value.gitUrl);
      if (!parsed.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gitUrl"],
          message: "A valid Git URL is required."
        });
      }
    }
  });

export type CreateDeploymentFields = z.infer<typeof createDeploymentSchema>;
