import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { RunStore } from '../runs/store.ts';
import { loadWorkflows, newerCatalogWorkflow } from '../workflows/load.ts';
import type { RunManager } from '../workflows/run.ts';
import { apiRequest } from './loopback-request.testkit.ts';
import { createApp } from './server.ts';

describe('global workflows', () => {
  let root: string;
  let repo: string;
  let home: string;
  let previousHome: string | undefined;
  let store: RunStore;
  const doc = (name: string, prompt: string) => `name: ${name}\nsteps:\n  - id: task\n    name: Task\n    prompt: "${prompt}"\n`;
  const globalFile = (name: string) => join(home, 'workflows', `${name}.yaml`);
  const projectFile = (name: string) => join(repo, '.ai/cezar/workflows', `${name}.yaml`);
  const putGlobal = (name: string, contents: string) => {
    mkdirSync(join(home, 'workflows'), { recursive: true });
    writeFileSync(globalFile(name), contents);
  };
  const app = () => createApp({ repoRoot: repo, store, manager: {} as RunManager, version: 'test' });
  const post = (path: string, body: unknown) => apiRequest(app(), path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cez-global-workflows-'));
    repo = join(root, 'repo');
    home = join(root, 'home');
    previousHome = process.env.CEZ_HOME;
    process.env.CEZ_HOME = home;
    mkdirSync(join(repo, '.ai/cezar'), { recursive: true });
    store = RunStore.open(join(repo, '.ai/cezar'));
  });
  afterEach(() => {
    store.flush();
    if (previousHome === undefined) delete process.env.CEZ_HOME;
    else process.env.CEZ_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('loads global files, with project over global over built-in and a missing folder allowed', async () => {
    expect((await loadWorkflows(repo)).issues).toEqual([]);
    putGlobal('demo', doc('demo', 'global'));
    putGlobal('quick-task', doc('quick-task', 'global override'));
    let catalog = await loadWorkflows(repo);
    expect(catalog.workflows.find((w) => w.name === 'demo')).toMatchObject({ source: 'file', global: true, path: globalFile('demo') });
    expect(catalog.workflows.find((w) => w.name === 'quick-task')?.steps[0]?.prompt).toBe('global override');
    mkdirSync(join(repo, '.ai/cezar/workflows'), { recursive: true });
    writeFileSync(projectFile('demo'), doc('demo', 'project'));
    catalog = await loadWorkflows(repo);
    expect(catalog.workflows.filter((w) => w.name === 'demo')).toHaveLength(1);
    expect(catalog.workflows.find((w) => w.name === 'demo')).toMatchObject({ source: 'file', path: projectFile('demo'), steps: [{ prompt: 'project' }] });
  });

  it('reports an invalid global file with its global path and still loads the rest', async () => {
    putGlobal('broken', 'name: broken\nsteps: nope\n');
    putGlobal('good', doc('good', 'global'));
    putGlobal('graph', stringifyYaml({ version: 2, name: 'graph', nodes: [{ id: 'start', type: 'start' }, { id: 'work', type: 'agent', prompt: '{{task}}' }], edges: [{ from: 'start', to: 'work' }] }));
    const catalog = await loadWorkflows(repo);
    expect(catalog.issues).toHaveLength(1);
    expect(catalog.issues[0]?.path).toBe(globalFile('broken'));
    expect(catalog.workflows.find((w) => w.name === 'good')).toMatchObject({ global: true });
    expect(catalog.workflows.find((w) => w.name === 'graph')).toMatchObject({ global: true, graph: expect.anything() });
  });

  it('refreshes queued global snapshots after edits', async () => {
    putGlobal('demo', doc('demo', 'before'));
    const snapshot = (await loadWorkflows(repo)).workflows.find((w) => w.name === 'demo')!;
    putGlobal('demo', doc('demo', 'after'));
    expect(newerCatalogWorkflow(snapshot, (await loadWorkflows(repo)).workflows)?.steps[0]?.prompt).toBe('after');
  });

  it('saves project copies through both routes and never deletes the global file', async () => {
    const original = doc('demo', 'global');
    putGlobal('demo', original);
    expect((await apiRequest(app(), '/api/v1/workflows/demo', { method: 'DELETE' })).status).toBe(400);
    expect(readFileSync(globalFile('demo'), 'utf8')).toBe(original);
    expect((await post('/api/v1/workflows', { name: 'demo', steps: [{ id: 'task', name: 'Task', prompt: 'edited' }] })).status).toBe(201);
    expect(readFileSync(projectFile('demo'), 'utf8')).toContain('edited');
    expect(readFileSync(globalFile('demo'), 'utf8')).toBe(original);
    expect((await apiRequest(app(), '/api/v1/workflows/demo', { method: 'DELETE' })).status).toBe(200);
    expect((await loadWorkflows(repo)).workflows.find((w) => w.name === 'demo')?.global).toBe(true);

    const graph = { nodes: [{ id: 'start', type: 'start' }, { id: 'work', type: 'agent', prompt: '{{task}}' }], edges: [{ from: 'start', to: 'work' }] };
    expect((await post('/api/v1/workflows/graph', { name: 'demo', graph })).status).toBe(201);
    expect(readFileSync(projectFile('demo'), 'utf8')).toBe(stringifyYaml({ version: 2, name: 'demo', ...graph }));
    expect(readFileSync(globalFile('demo'), 'utf8')).toBe(original);
  });
});
