/**
 * Roles API - Role template CRUD endpoints
 *
 * Endpoints:
 * - POST /api/roles
 * - GET /api/roles
 * - GET /api/roles/:role_id
 * - PUT /api/roles/:role_id
 * - DELETE /api/roles/:role_id
 */

import { Router, type Request, type Response } from 'express';
import { CreateRoleSchema } from '../../types/orchestrator.js';
import { AgentError, ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { RoleRepository } from '../runtime/role-repository.js';

export interface RolesRouterConfig {
  roleRepository: RoleRepository;
}

export function createRolesRouter(config: RolesRouterConfig): Router {
  const router = Router();
  const { roleRepository } = config;

  // POST /api/roles
  router.post('/roles', (req: Request, res: Response) => {
    void (async () => {
      try {
        const parseResult = CreateRoleSchema.safeParse(req.body);
        if (!parseResult.success) {
          const firstError = parseResult.error.errors[0];
          throw new ValidationError(
            firstError?.message ?? 'Invalid request',
            firstError?.path.join('.') ?? 'body'
          );
        }

        const role = await roleRepository.create(parseResult.data);
        logger.info('Role created', { roleId: role.id });
        res.status(201).json(role);
      } catch (err) {
        handleError(res, err);
      }
    })();
  });

  // GET /api/roles
  router.get('/roles', (_req: Request, res: Response) => {
    void (async () => {
      try {
        const roles = await roleRepository.list();
        res.json({ roles });
      } catch (err) {
        handleError(res, err);
      }
    })();
  });

  // GET /api/roles/:role_id
  router.get('/roles/:role_id', (req: Request, res: Response) => {
    void (async () => {
      try {
        const role = await roleRepository.require(req.params.role_id!);
        res.json(role);
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
  logger.error('Roles API error', { err: String(err) });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message },
  });
}
