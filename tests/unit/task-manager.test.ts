import { describe, expect, it } from 'vitest';
import type { TaskManagerProcess, TaskManagerProcessType, TaskManagerSnapshot } from '../../src/shared/types';

describe('TaskManager data models and metrics', () => {
  const sampleProcesses: TaskManagerProcess[] = [
    {
      pid: 100,
      type: 'browser',
      title: 'Браузер (Основной процесс)',
      cpuPercent: 5.0,
      memoryWorkingSetMB: 150,
      isKillable: false,
    },
    {
      pid: 101,
      type: 'shell',
      title: 'Интерфейс soulm8te',
      cpuPercent: 10.0,
      memoryWorkingSetMB: 250,
      isKillable: false,
    },
    {
      pid: 102,
      type: 'tab',
      title: 'GitHub: Let\'s build from here',
      url: 'https://github.com',
      cpuPercent: 20.0,
      memoryWorkingSetMB: 1200,
      isKillable: true,
    },
    {
      pid: 103,
      type: 'gpu',
      title: 'Процесс GPU',
      cpuPercent: 1.5,
      memoryWorkingSetMB: 100,
      isKillable: true,
    },
    {
      pid: 104,
      type: 'tab',
      title: 'Яндекс Поиск',
      url: 'https://ya.ru',
      cpuPercent: 0.5,
      memoryWorkingSetMB: 80,
      isKillable: true,
    },
  ];

  it('correctly calculates total memory and average cpu', () => {
    const snapshot: TaskManagerSnapshot = {
      sampledAt: Date.now(),
      processes: sampleProcesses,
    };

    expect(snapshot.processes).toHaveLength(5);

    const totalMem = snapshot.processes.reduce((sum, p) => sum + p.memoryWorkingSetMB, 0);
    expect(totalMem).toBe(1780);

    const avgCpu = snapshot.processes.reduce((sum, p) => sum + p.cpuPercent, 0) / snapshot.processes.length;
    expect(avgCpu).toBe(7.4);
  });

  it('correctly identifies killable vs protected system processes', () => {
    const browserProc: TaskManagerProcess = {
      pid: 1,
      type: 'browser',
      title: 'Браузер (Основной процесс)',
      cpuPercent: 2.0,
      memoryWorkingSetMB: 120,
      isKillable: false,
    };

    const shellProc: TaskManagerProcess = {
      pid: 2,
      type: 'shell',
      title: 'Интерфейс soulm8te',
      cpuPercent: 4.0,
      memoryWorkingSetMB: 180,
      isKillable: false,
    };

    const tabProc: TaskManagerProcess = {
      pid: 3,
      type: 'tab',
      title: 'Вкладка',
      url: 'https://example.com',
      cpuPercent: 1.0,
      memoryWorkingSetMB: 90,
      isKillable: true,
    };

    const gpuProc: TaskManagerProcess = {
      pid: 4,
      type: 'gpu',
      title: 'GPU',
      cpuPercent: 0.5,
      memoryWorkingSetMB: 50,
      isKillable: true,
    };

    expect(browserProc.isKillable).toBe(false);
    expect(shellProc.isKillable).toBe(false);
    expect(tabProc.isKillable).toBe(true);
    expect(gpuProc.isKillable).toBe(true);
  });

  it('formats cpu thresholds properly', () => {
    const getCpuClass = (cpu: number) => (cpu > 80 ? 'cpu-danger' : cpu > 50 ? 'cpu-warning' : 'cpu-normal');
    expect(getCpuClass(10)).toBe('cpu-normal');
    expect(getCpuClass(50)).toBe('cpu-normal');
    expect(getCpuClass(50.1)).toBe('cpu-warning');
    expect(getCpuClass(80)).toBe('cpu-warning');
    expect(getCpuClass(80.5)).toBe('cpu-danger');
  });

  it('formats memory heavy badges properly', () => {
    const isHeavy = (memMB: number) => memMB > 1024;
    expect(isHeavy(512)).toBe(false);
    expect(isHeavy(1024)).toBe(false);
    expect(isHeavy(1025)).toBe(true);
    expect(isHeavy(2048)).toBe(true);
  });

  describe('Filtering and searching processes', () => {
    function filterProcesses(list: TaskManagerProcess[], query: string): TaskManagerProcess[] {
      const q = query.trim().toLowerCase();
      if (!q) return list;
      return list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.url && p.url.toLowerCase().includes(q)) ||
          p.pid.toString().includes(q) ||
          p.type.toLowerCase().includes(q)
      );
    }

    it('filters by process title case-insensitively', () => {
      const res = filterProcesses(sampleProcesses, 'github');
      expect(res).toHaveLength(1);
      expect(res[0].pid).toBe(102);

      const resRu = filterProcesses(sampleProcesses, 'яндекс');
      expect(resRu).toHaveLength(1);
      expect(resRu[0].pid).toBe(104);
    });

    it('filters by URL', () => {
      const res = filterProcesses(sampleProcesses, 'ya.ru');
      expect(res).toHaveLength(1);
      expect(res[0].title).toBe('Яндекс Поиск');
    });

    it('filters by PID', () => {
      const res = filterProcesses(sampleProcesses, '103');
      expect(res).toHaveLength(1);
      expect(res[0].type).toBe('gpu');
    });

    it('filters by process type', () => {
      const res = filterProcesses(sampleProcesses, 'tab');
      expect(res).toHaveLength(2);
    });

    it('returns all processes for empty search query', () => {
      expect(filterProcesses(sampleProcesses, '')).toHaveLength(5);
      expect(filterProcesses(sampleProcesses, '   ')).toHaveLength(5);
    });
  });

  describe('Sorting processes', () => {
    type SortField = 'name' | 'pid' | 'cpu' | 'memory' | 'type';
    type SortDir = 'asc' | 'desc';

    function sortProcesses(list: TaskManagerProcess[], field: SortField, dir: SortDir): TaskManagerProcess[] {
      return [...list].sort((a, b) => {
        let diff = 0;
        if (field === 'name') {
          diff = a.title.localeCompare(b.title, 'ru-RU');
        } else if (field === 'pid') {
          diff = a.pid - b.pid;
        } else if (field === 'cpu') {
          diff = a.cpuPercent - b.cpuPercent;
        } else if (field === 'memory') {
          diff = a.memoryWorkingSetMB - b.memoryWorkingSetMB;
        } else if (field === 'type') {
          diff = a.type.localeCompare(b.type);
        }
        return dir === 'asc' ? diff : -diff;
      });
    }

    it('sorts by CPU descending (highest CPU first)', () => {
      const sorted = sortProcesses(sampleProcesses, 'cpu', 'desc');
      expect(sorted[0].pid).toBe(102); // 20.0%
      expect(sorted[1].pid).toBe(101); // 10.0%
      expect(sorted[sorted.length - 1].pid).toBe(104); // 0.5%
    });

    it('sorts by Memory descending (heaviest process first)', () => {
      const sorted = sortProcesses(sampleProcesses, 'memory', 'desc');
      expect(sorted[0].pid).toBe(102); // 1200 MB
      expect(sorted[1].pid).toBe(101); // 250 MB
      expect(sorted[sorted.length - 1].pid).toBe(104); // 80 MB
    });

    it('sorts by PID ascending', () => {
      const sorted = sortProcesses(sampleProcesses, 'pid', 'asc');
      expect(sorted.map((p) => p.pid)).toEqual([100, 101, 102, 103, 104]);
    });

    it('sorts by Name ascending and descending', () => {
      const asc = sortProcesses(sampleProcesses, 'name', 'asc');
      const desc = sortProcesses(sampleProcesses, 'name', 'desc');
      expect(asc[0].title).toBe(desc[desc.length - 1].title);
    });
  });
});
