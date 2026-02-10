/**
 * Groups API - Group and member management endpoints
 *
 * Endpoints:
 * - POST /api/groups
 * - GET /api/groups
 * - GET /api/groups/:group_id
 * - POST /api/groups/:group_id/members
 * - GET /api/groups/:group_id/members
 * - POST /api/groups/:group_id/runs
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { QueuedRun } from '../../types/api.js';
import { LLMConfigRequestSchema } from '../../types/api.js';
import { CreateGroupSchema, AddMemberSchema } from '../../types/orchestrator.js';
import { AgentError, ValidationError } from '../../utils/errors.js';
import { generateRunId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';
import { GroupRepository } from '../runtime/group-repository.js';
import { resolveRequestScope } from '../runtime/request-scope.js';
import { RoleRepository } from '../runtime/role-repository.js';
import { RunRepository } from '../runtime/run-repository.js';
import { RunQueue } from '../queue/run-queue.js';

export interface GroupsRouterConfig {
  groupRepository: GroupRepository;
  roleRepository: RoleRepository;
  runRepository: RunRepository;
  runQueue: RunQueue;
}

const GroupRunRequestSchema = z.object({
  input: z.string().min(1),
  session_key: z.string().regex(/^s_[a-zA-Z0-9_]+$/).optional(),
  llm_config: LLMConfigRequestSchema,
});

export function createGroupsRouter(config: GroupsRouterConfig): Router {
  const router = Router();
  const { groupRepository, roleRepository, runRepository, runQueue } = config;

  // POST /api/groups
  router.post('/groups', (req: Request, res: Response) => {
    void (async () => {
      try {
        const parseResult = CreateGroupSchema.safeParse(req.body);
        if (!parseResult.success) {
          const firstError = parseResult.error.errors[0];
          throw new ValidationError(
            firstError?.message ?? 'Invalid request',
            firstError?.path.join('.') ?? 'body'
          );
        }
        const group = await groupRepository.createGroup(parseResult.data);
        logger.info('Group created', { groupId: group.id });
        res.status(201).json(group);
      } catch (err) {
        handleError(res, err);
      }
    })();
  });

  // GET /api/groups
  router.get('/groups', (req: Request, res: Response) => {
    void (async () => {
      try {
        const projectId = req.query.project_id as string | undefined;
        const groups = await groupRepository.listGroups(projectId);
        res.json({ groups });
      } catch (err) {
        handleError(res, err);
      }
    })();
  });

  // GET /api/groups/:group_id
  router.get('/groups/:group_id', (req: Request, res: Response) => {
    void (async () => {
      try {
        const group = await groupRepository.requireGroup(req.params.group_id!);
        res.json(group);
      } catch (err) {
        handleError(res, err);
      }
    })();
  });

  // POST /api/groups/:group_id/members
  router.post('/groups/:group_id/members', (req: Request, res: Response) => {
    void (async () => {
      try {
        const parseResult = AddMemberSchema.safeParse(req.body);
        if (!parseResult.success) {
          const firstError = parseResult.error.errors[0];
          throw new ValidationError(
            firstError?.message ?? 'Invalid request',
            firstError?.path.join('.') ?? 'body'
          );
        }
        await roleRepository.require(parseResult.data.role_id);
        const member = await groupRepository.addMember(
          req.params.group_id!,
          parseResult.data
        );
        logger.info('Member added to group', {
          groupId: req.params.group_id,
          roleId: parseResult.data.role_id,
        });
        res.status(201).json(member);
      } catch (err) {
        handleError(res, err);
      }
    })();
  });

  // GET /api/groups/:group_id/members
  router.get('/groups/:group_id/members', (req: Request, res: Response) => {
    void (async () => {
      try {
        await groupRepository.requireGroup(req.params.group_id!);
        const members = await groupRepository.listMembers(req.params.group_id!);
        res.json({ members });
      } catch (err) {
        handleError(res, err);
      }
    })();
  });

  // POST /api/groups/:group_id/runs
  router.post('/groups/:group_id/runs', (req: Request, res: Response) => {
    void (async () => {
      try {
        const groupId = req.params.group_id!;
        await groupRepository.requireGroup(groupId);

        const members = await groupRepository.listMembers(groupId);
        if (members.length === 0) {
          throw new ValidationError('Group has no members', 'group_id');
        }

        const parseResult = GroupRunRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          const firstError = parseResult.error.errors[0];
          throw new ValidationError(
            firstError?.message ?? 'Invalid request',
            firstError?.path.join('.') ?? 'body'
          );
        }
        const { input, session_key, llm_config } = parseResult.data;

        const scope = resolveRequestScope(req);
        const runId = generateRunId();
        const sessionKey = session_key ?? 's_default';
        const agentId = `group:${groupId}`;

        const created = await runRepository.createRun({
          id: runId,
          scope,
          sessionKey,
          input,
          agentId,
          llmConfig: llm_config ?? null,
        });

        const queuedRun: QueuedRun = {
          run_id: created.id,
          org_id: created.orgId,
          user_id: created.userId,
          ...(created.projectId ? { project_id: created.projectId } : {}),
          session_key: created.sessionKey,
          input: created.input,
          agent_id: created.agentId,
          created_at: created.createdAt,
          status: 'pending',
          llm_config: created.llmConfig ?? undefined,
          group_id: groupId,
        };
        runQueue.enqueue(queuedRun);

        logger.info('Group run created', {
          groupId,
          runId: created.id,
          memberCount: members.length,
        });

        res.status(201).json({
          run_id: created.id,
          group_id: groupId,
          status: created.status,
          created_at: created.createdAt,
        });
      } catch (err) {
        handleError(res, err);
      }
    })();
  });

  return router;
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof AgentError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  logger.error('Groups API error', { err: String(err) });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message },
  });
}