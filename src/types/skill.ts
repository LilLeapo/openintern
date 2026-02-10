import { z } from 'zod';

// ─── Risk Level ─────────────────────────────────────────────

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// ─── Skill Provider ─────────────────────────────────────────

export const SkillProviderSchema = z.enum(['builtin', 'mcp']);
export type SkillProvider = z.infer<typeof SkillProviderSchema>;

// ─── Skill Tool Entry ───────────────────────────────────────

export const SkillToolEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  parameters: z.record(z.unknown()).default({}),
});

export type SkillToolEntry = z.infer<typeof SkillToolEntrySchema>;

// ─── Skill ──────────────────────────────────────────────────

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  tools: z.array(SkillToolEntrySchema).default([]),
  risk_level: RiskLevelSchema.default('low'),
  provider: SkillProviderSchema.default('builtin'),
  health_status: z.enum(['healthy', 'unhealthy', 'unknown']).default('unknown'),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type Skill = z.infer<typeof SkillSchema>;

// ─── Create Skill ───────────────────────────────────────────

export const CreateSkillSchema = SkillSchema.omit({
  id: true,
  health_status: true,
  created_at: true,
  updated_at: true,
});

export type CreateSkill = z.infer<typeof CreateSkillSchema>;
