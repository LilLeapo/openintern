import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ORG_ID = process.env['E2E_ORG_ID'] ?? 'org_playwright_e2e';
const USER_ID = process.env['E2E_USER_ID'] ?? 'user_playwright_e2e';

function scopeHeaders(): Record<string, string> {
  return {
    'x-org-id': ORG_ID,
    'x-user-id': USER_ID,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunStatus(
  request: APIRequestContext,
  runId: string,
  expectedStatus: 'completed' | 'failed',
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await request.get(`/api/runs/${runId}`, {
      headers: scopeHeaders(),
    });

    if (response.ok()) {
      const body = (await response.json()) as { status?: string };
      if (body.status === expectedStatus) {
        return;
      }

      if (body.status === 'failed' && expectedStatus !== 'failed') {
        throw new Error(`Run ${runId} failed unexpectedly`);
      }
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting run ${runId} status ${expectedStatus}`);
}

async function createRunFromChat(page: Page, prompt: string): Promise<string> {
  const createRunResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/runs') &&
      response.status() === 201
  );

  await page.getByRole('textbox', { name: 'Message input' }).fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText(prompt)).toBeVisible();

  const response = await createRunResponse;
  const data = (await response.json()) as { run_id?: string };
  const runId = data.run_id;

  expect(runId).toBeTruthy();
  expect(runId).toMatch(/^run_/);
  return runId!;
}

test.describe('Web chat to trace e2e', () => {
  test.skip(process.env['E2E_MOCK_ONLY'] === '1', 'This suite requires a live backend.');

  test('creates a run from chat and validates trace details', async ({ page, request }) => {
    const prompt = `playwright chat trace ${Date.now()}`;

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Agent Chat Workspace' })).toBeVisible();

    const runId = await createRunFromChat(page, prompt);
    await waitForRunStatus(request, runId, 'completed');

    await page.goto(`/trace/${runId}`);

    await expect(page.getByRole('heading', { name: `Trace ${runId}` })).toBeVisible();
    await expect(page.getByText(`Run: ${runId}`)).toBeVisible();
    await expect(page.getByText(/^completed$/)).toBeVisible();
    await expect(page.getByText(prompt)).toBeVisible();
    await expect(page.getByText('I have completed the task.')).toBeVisible();
    await expect(page.getByText('Step 1')).toBeVisible();
  });

  test('navigates from runs list to trace page for the created run', async ({ page, request }) => {
    const prompt = `playwright runs trace ${Date.now()}`;

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Agent Chat Workspace' })).toBeVisible();

    const runId = await createRunFromChat(page, prompt);
    await waitForRunStatus(request, runId, 'completed');

    await page.getByRole('button', { name: 'Open Runs' }).click();
    await expect(page.getByRole('heading', { name: 'Runs History' })).toBeVisible();

    const runCard = page.locator('article', { hasText: runId });
    await expect(runCard).toBeVisible();
    await runCard.getByRole('button', { name: 'View Trace' }).click();

    await expect(page).toHaveURL(new RegExp(`/trace/${runId}$`));
    await expect(page.getByRole('heading', { name: `Trace ${runId}` })).toBeVisible();
    await expect(page.getByText(`Run: ${runId}`)).toBeVisible();
  });
});
