import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Group, GroupMember, GroupRunSummary, Role, RunMeta, Skill } from '../src/types';
import type { Event } from '../src/types/events';

function makeRun(run: Partial<RunMeta> & { run_id: string; status: RunMeta['status'] }): RunMeta {
  return {
    session_key: 's_default',
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_ms: null,
    event_count: 0,
    tool_call_count: 0,
    ...run,
  };
}

test.describe('Product features', () => {
  test('runs page supports filtering and pending cancel action', async ({ page }) => {
    let runs: RunMeta[] = [
      makeRun({
        run_id: 'run_pending_1',
        status: 'pending',
      }),
      makeRun({
        run_id: 'run_completed_1',
        status: 'completed',
        duration_ms: 923,
      }),
    ];

    await page.route('**/api/sessions/s_default/runs**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runs,
          total: runs.length,
          page: 1,
          limit: 20,
        }),
      });
    });

    await page.route('**/api/runs/run_pending_1/cancel', async route => {
      runs = runs.map(run =>
        run.run_id === 'run_pending_1'
          ? {
              ...run,
              status: 'cancelled',
              ended_at: new Date().toISOString(),
              duration_ms: 10,
            }
          : run,
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, run_id: 'run_pending_1' }),
      });
    });

    await page.goto('/runs');
    await expect(page.getByRole('heading', { name: 'Runs History' })).toBeVisible();
    await expect(page.getByText('run_pending_1')).toBeVisible();
    await expect(page.getByText('run_completed_1')).toBeVisible();

    await page.getByRole('button', { name: 'pending', exact: true }).click();
    await expect(page.getByText('run_pending_1')).toBeVisible();
    await expect(page.getByText('run_completed_1')).not.toBeVisible();

    await page
      .locator('article', { hasText: 'run_pending_1' })
      .getByRole('button', { name: 'Cancel Run' })
      .click();
    await page.getByRole('button', { name: 'cancelled', exact: true }).click();
    await expect(page.getByText('run_pending_1')).toBeVisible();

    await page.getByRole('button', { name: 'all', exact: true }).click();
    await page.getByLabel('Search runs').fill('run_completed_1');
    await expect(page.getByText('run_completed_1')).toBeVisible();
    await expect(page.getByText('run_pending_1')).not.toBeVisible();
  });

  test('blackboard page writes memory and refreshes list', async ({ page }) => {
    const groups: Group[] = [
      {
        id: 'group_alpha',
        name: 'Alpha Group',
        description: 'E2E group',
        project_id: null,
      },
    ];
    const roles: Role[] = [
      {
        id: 'role_writer',
        name: 'Writer',
        description: 'Writes board items',
        system_prompt: 'Write clean updates',
        is_lead: true,
      },
    ];
    let memories: Array<{
      id: string;
      type: 'core' | 'episodic' | 'archival';
      text: string;
      metadata: Record<string, unknown>;
      created_at: string;
      updated_at: string;
      group_id: string;
    }> = [];

    await page.route('**/api/groups', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ groups }),
      });
    });

    await page.route('**/api/roles', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ roles }),
      });
    });

    await page.route('**/api/groups/group_alpha/blackboard', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ memories }),
        });
        return;
      }

      const body = route.request().postDataJSON() as {
        text: string;
        metadata?: Record<string, unknown>;
      };
      const now = new Date().toISOString();
      memories = [
        ...memories,
        {
          id: `mem_${memories.length + 1}`,
          type: 'episodic',
          text: body.text,
          metadata: body.metadata ?? {},
          created_at: now,
          updated_at: now,
          group_id: 'group_alpha',
        },
      ];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: memories[memories.length - 1]?.id ?? 'mem_1' }),
      });
    });

    await page.goto('/blackboard');
    await expect(page.getByRole('heading', { name: 'Group Blackboard' })).toBeVisible();

    await page.getByLabel('Type').selectOption('TODO');
    await page.getByLabel('Content').fill('Write onboarding checklist');
    await page.getByRole('button', { name: 'Write to Blackboard' }).click();

    await expect(page.getByText('Write onboarding checklist')).toBeVisible();
  });

  test('trace page exports filtered events as JSON', async ({ page }) => {
    const events: Event[] = [
      {
        v: 1,
        ts: new Date().toISOString(),
        session_key: 's_export',
        run_id: 'run_export',
        agent_id: 'main',
        step_id: 'step_1',
        span_id: 'span_start',
        parent_span_id: null,
        redaction: { contains_secrets: false },
        type: 'run.started',
        payload: { input: 'export trace' },
      },
      {
        v: 1,
        ts: new Date().toISOString(),
        session_key: 's_export',
        run_id: 'run_export',
        agent_id: 'main',
        step_id: 'step_1',
        span_id: 'span_tool',
        parent_span_id: null,
        redaction: { contains_secrets: false },
        type: 'tool.called',
        payload: { toolName: 'memory_search', args: { query: 'release notes' } },
      },
      {
        v: 1,
        ts: new Date().toISOString(),
        session_key: 's_export',
        run_id: 'run_export',
        agent_id: 'main',
        step_id: 'step_1',
        span_id: 'span_done',
        parent_span_id: null,
        redaction: { contains_secrets: false },
        type: 'run.completed',
        payload: { output: 'done', duration_ms: 12 },
      },
    ];

    await page.route('**/api/runs/run_export/events**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events,
          total: events.length,
        }),
      });
    });

    await page.route('**/api/runs/run_export/stream**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: '',
      });
    });

    await page.goto('/trace/run_export');
    await expect(page.getByRole('heading', { name: 'Trace run_export' })).toBeVisible();
    await expect(page.getByText('Run: run_export')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;
    const outputPath = test.info().outputPath('trace-export.json');
    await download.saveAs(outputPath);

    const content = await fs.readFile(outputPath, 'utf8');
    const parsed = JSON.parse(content) as Event[];
    expect(parsed).toHaveLength(3);
    expect(parsed[0]?.type).toBe('run.started');
  });

  test('orchestrator page supports role/group/group-run workflow', async ({ page }) => {
    let roles: Role[] = [];
    const skills: Skill[] = [];
    let groups: Group[] = [];
    const membersByGroup: Record<string, GroupMember[]> = {};
    let groupRunCounter = 0;

    await page.route('**/api/roles', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ roles }),
        });
        return;
      }
      const body = route.request().postDataJSON() as {
        name: string;
        description?: string;
        system_prompt: string;
        is_lead?: boolean;
      };
      const created: Role = {
        id: `role_${roles.length + 1}`,
        name: body.name,
        description: body.description ?? '',
        system_prompt: body.system_prompt,
        is_lead: body.is_lead ?? false,
      };
      roles = [created, ...roles];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    });

    await page.route('**/api/skills', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ skills }),
      });
    });

    await page.route('**/api/groups', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ groups }),
        });
        return;
      }
      const body = route.request().postDataJSON() as { name: string; description?: string };
      const created: Group = {
        id: `group_${groups.length + 1}`,
        name: body.name,
        description: body.description ?? '',
        project_id: null,
      };
      groups = [created, ...groups];
      membersByGroup[created.id] = [];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    });

    await page.route('**/api/groups/*/members', async route => {
      const url = new URL(route.request().url());
      const groupId = url.pathname.split('/')[3];
      if (!groupId) {
        await route.fulfill({ status: 400 });
        return;
      }

      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ members: membersByGroup[groupId] ?? [] }),
        });
        return;
      }

      const body = route.request().postDataJSON() as { role_id: string; ordinal?: number };
      const created: GroupMember = {
        id: `member_${(membersByGroup[groupId] ?? []).length + 1}`,
        group_id: groupId,
        role_id: body.role_id,
        agent_instance_id: null,
        ordinal: body.ordinal ?? 0,
      };
      membersByGroup[groupId] = [...(membersByGroup[groupId] ?? []), created];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    });

    await page.route('**/api/groups/*/runs', async route => {
      const url = new URL(route.request().url());
      const groupId = url.pathname.split('/')[3];
      groupRunCounter += 1;
      const created: GroupRunSummary = {
        run_id: `run_group_${groupRunCounter}`,
        group_id: groupId ?? 'group_1',
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    });

    await page.route('**/api/runs/run_group_1/events**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [], total: 0 }),
      });
    });

    await page.route('**/api/runs/run_group_1/stream**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: '',
      });
    });

    await page.goto('/orchestrator');
    await expect(page.getByRole('heading', { name: 'Orchestrator Studio' })).toBeVisible();

    const createRoleCard = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'Create Role', exact: true }),
    });
    const createGroupCard = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'Create Group', exact: true }),
    });
    const addMemberCard = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'Add Group Member', exact: true }),
    });
    const createGroupRunCard = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'Create Group Run', exact: true }),
    });

    await createRoleCard.getByLabel('Name').fill('Planner');
    await createRoleCard
      .getByLabel('System Prompt')
      .fill('Plan tasks and split work');
    await createRoleCard.getByRole('button', { name: 'Create Role', exact: true }).click();

    await createGroupCard.getByLabel('Name').fill('Alpha');
    await createGroupCard.getByRole('button', { name: 'Create Group', exact: true }).click();

    await addMemberCard.getByRole('button', { name: 'Add Member', exact: true }).click();

    await createGroupRunCard.getByLabel('Run Input').fill('Plan deployment');
    await createGroupRunCard.getByRole('button', { name: 'Create Group Run', exact: true }).click();

    await expect(page.getByText('Created group run run_group_1')).toBeVisible();
    await page.getByRole('button', { name: 'Open Trace' }).click();
    await expect(page).toHaveURL(/\/trace\/run_group_1$/);
  });

  test('skills page supports create and delete flow', async ({ page }) => {
    let skills: Skill[] = [];

    await page.route('**/api/skills', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ skills }),
        });
        return;
      }

      const body = route.request().postDataJSON() as {
        name: string;
        description?: string;
        provider?: 'builtin' | 'mcp';
        risk_level?: 'low' | 'medium' | 'high';
        tools?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
      };
      const created: Skill = {
        id: `skill_${skills.length + 1}`,
        name: body.name,
        description: body.description ?? '',
        provider: body.provider ?? 'builtin',
        risk_level: body.risk_level ?? 'low',
        health_status: 'unknown',
        tools: (body.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description ?? '',
          parameters: tool.parameters ?? {},
        })),
      };
      skills = [created, ...skills];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
    });

    await page.route('**/api/skills/*', async route => {
      const url = new URL(route.request().url());
      const skillId = url.pathname.split('/').at(-1);
      if (!skillId) {
        await route.fulfill({ status: 400 });
        return;
      }
      if (route.request().method() === 'DELETE') {
        skills = skills.filter((skill) => skill.id !== skillId);
        await route.fulfill({ status: 204 });
        return;
      }
      const skill = skills.find((item) => item.id === skillId);
      if (!skill) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Skill not found' } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(skill),
      });
    });

    await page.goto('/skills');
    await expect(page.getByRole('heading', { name: 'Skills Catalog' })).toBeVisible();

    await page.getByLabel('Skill Name').fill('Knowledge');
    await page.getByLabel('Description').fill('Knowledge lookup and retrieval');
    await page.getByLabel('Tools').fill('memory_search|semantic lookup');
    await page.getByRole('button', { name: 'Create Skill' }).click();

    await expect(page.getByText('Created skill skill_1')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Knowledge' })).toBeVisible();
    await expect(page.getByText('memory_search - semantic lookup')).toBeVisible();

    await page.locator('article', { hasText: 'skill_1' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Deleted skill skill_1')).toBeVisible();
    await expect(page.locator('article', { has: page.getByRole('heading', { name: 'Knowledge' }) })).toHaveCount(0);
  });
});
