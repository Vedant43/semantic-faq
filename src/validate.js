import { z } from "zod";

export const documentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(1000),
});

export const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
});
