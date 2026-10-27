import { describe, expect, it } from 'vitest';
import { NoteMutationQueue } from '../../src/renderer/QuickNotesDrawer';

describe('note persistence ordering', () => {
  it('coalesces typing and flushes the final draft before a pin operation', async () => {
    const queue = new NoteMutationQueue();
    const actions: string[] = [];
    queue.schedule('a', async () => { actions.push('old text'); });
    queue.schedule('a', async () => { actions.push('latest text'); });
    void queue.flush();
    await queue.enqueue(async () => { actions.push('pin'); });
    expect(actions).toEqual(['latest text', 'pin']);
  });

  it('waits for an in-flight save before deleting and cancels a pending newer save', async () => {
    const queue = new NoteMutationQueue();
    const actions: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    queue.schedule('a', async () => { await blocked; actions.push('save'); });
    void queue.flush();
    queue.schedule('a', async () => { actions.push('resurrection'); });
    queue.cancel('a');
    const deletion = queue.enqueue(async () => { actions.push('delete'); });
    release();
    await deletion;
    await queue.flush();
    expect(actions).toEqual(['save', 'delete']);
  });

  it('flushes separate note drafts across selection changes without losing either', async () => {
    const queue = new NoteMutationQueue();
    const saved: string[] = [];
    queue.schedule('a', async () => { saved.push('a'); });
    void queue.flush();
    queue.schedule('b', async () => { saved.push('b'); });
    await queue.flush();
    expect(saved).toEqual(['a', 'b']);
  });

  it('does not poison subsequent persistence operations after a rejected write', async () => {
    const queue = new NoteMutationQueue();
    await expect(queue.enqueue(async () => { throw new Error('disk'); })).rejects.toThrow('disk');
    await expect(queue.enqueue(async () => 'recovered')).resolves.toBe('recovered');
  });
});
