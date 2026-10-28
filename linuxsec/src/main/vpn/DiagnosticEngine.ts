import dns from 'node:dns/promises';
import { exec } from 'node:child_process';
import util from 'node:util';
import type { DiagnosticStepResult, DiagnosticsReport, VpnTunnelStatus } from '../../shared/types';
import type { PublicIpService } from './PublicIpService';
import type { PingService } from './PingService';

const execAsync = util.promisify(exec);

export class DiagnosticEngine {
  constructor(
    private publicIpService: PublicIpService,
    private pingService: PingService
  ) {}

  public async runDiagnostics(tunnelStatus: VpnTunnelStatus): Promise<DiagnosticsReport> {
    const steps: DiagnosticStepResult[] = [];
    const timestamp = Date.now();

    // Step 1: Default Gateway Reachability
    try {
      const { stdout } = await execAsync("ip route show default | head -n1 | awk '{print $3}'");
      const gateway = stdout.trim();
      if (gateway) {
        const ping = await this.pingService.measureLatency(`${gateway}:80`, 1200);
        steps.push({
          id: 'gateway',
          title: 'Шлюз локальной сети (Default Gateway)',
          status: ping < 999 ? 'success' : 'warning',
          message: ping < 999 ? `Шлюз ${gateway} доступен` : `Шлюз ${gateway} отвечает с задержкой`,
          latencyMs: ping < 999 ? ping : undefined,
          details: `Default gateway IP: ${gateway}`,
        });
      } else {
        steps.push({
          id: 'gateway',
          title: 'Шлюз по умолчанию',
          status: 'warning',
          message: 'Маршрут по умолчанию не обнаружен',
        });
      }
    } catch (err) {
      steps.push({
        id: 'gateway',
        title: 'Шлюз локальной сети',
        status: 'error',
        message: 'Ошибка проверки шлюза',
        details: String(err),
      });
    }

    // Step 2: DNS Resolution
    try {
      const start = Date.now();
      const lookup = await dns.lookup('cloudflare.com');
      const duration = Date.now() - start;
      steps.push({
        id: 'dns',
        title: 'Разрешение DNS (DNS Resolution)',
        status: 'success',
        message: `Домен успешно разрешен в ${lookup.address}`,
        latencyMs: duration,
        details: `Resolved IP: ${lookup.address}, family: IPv${lookup.family}`,
      });
    } catch (err) {
      steps.push({
        id: 'dns',
        title: 'Разрешение DNS',
        status: 'error',
        message: 'Сбой разрешения доменных имен через DNS',
        details: String(err),
      });
    }

    // Step 3: Tunnel Interface State
    if (tunnelStatus.state === 'connected') {
      const iface = tunnelStatus.interfaceName || 'linuxsec';
      try {
        const { stdout } = await execAsync(`ip addr show dev ${iface} 2>&1 || true`);
        if (stdout.includes(iface)) {
          steps.push({
            id: 'interface',
            title: 'Сетевой интерфейс туннеля (VPN Interface)',
            status: 'success',
            message: `Интерфейс ${iface} активен в ядре Linux`,
            details: stdout.slice(0, 180),
          });
        } else {
          steps.push({
            id: 'interface',
            title: 'Сетевой интерфейс туннеля',
            status: 'warning',
            message: `Интерфейс ${iface} не найден в таблице сетевых устройств`,
          });
        }
      } catch (err) {
        steps.push({
          id: 'interface',
          title: 'Сетевой интерфейс туннеля',
          status: 'error',
          message: 'Ошибка инспекции интерфейса',
          details: String(err),
        });
      }
    } else {
      steps.push({
        id: 'interface',
        title: 'Статус туннеля',
        status: 'warning',
        message: 'VPN отключен. Проверка интерфейса туннеля пропущена.',
      });
    }

    // Step 4: External Public IP Check
    try {
      const ipInfo = await this.publicIpService.getPublicIp(true);
      const isConnected = tunnelStatus.state === 'connected';
      const originalIp = tunnelStatus.originalPublicIp?.ip;
      const isChanged = originalIp && originalIp !== ipInfo.ip;

      steps.push({
        id: 'ip-mask',
        title: 'Внешний IP-адрес и геолокация',
        status: isConnected && isChanged ? 'success' : isConnected ? 'warning' : 'success',
        message: isConnected && isChanged
          ? `IP успешно скрыт: ${ipInfo.ip} (${ipInfo.country || 'Защищено'})`
          : `Текущий IP: ${ipInfo.ip} (${ipInfo.country || 'Локальный'})`,
        details: `IP: ${ipInfo.ip}, ISP: ${ipInfo.isp || 'N/A'}, City: ${ipInfo.city || 'N/A'}`,
      });
    } catch (err) {
      steps.push({
        id: 'ip-mask',
        title: 'Внешний IP-адрес',
        status: 'error',
        message: 'Не удалось определить внешний IP-адрес',
        details: String(err),
      });
    }

    // Step 5: IPv6 Leak Audit
    try {
      const { stdout } = await execAsync('ip -6 route show default 2>&1 || true');
      const hasIpv6Default = stdout.trim().length > 0;
      if (tunnelStatus.state === 'connected' && hasIpv6Default) {
        steps.push({
          id: 'ipv6-leak',
          title: 'Защита от утечек IPv6 (IPv6 Leak Check)',
          status: 'warning',
          message: 'Обнаружен активный маршрут IPv6 по умолчанию',
          details: stdout.trim(),
        });
      } else {
        steps.push({
          id: 'ipv6-leak',
          title: 'Защита от утечек IPv6',
          status: 'success',
          message: 'Утечек через IPv6 не обнаружено',
        });
      }
    } catch {
      steps.push({
        id: 'ipv6-leak',
        title: 'Защита от утечек IPv6',
        status: 'success',
        message: 'Маршрутизация IPv6 отключена или защищена',
      });
    }

    // Determine overall status
    let overallStatus: 'pass' | 'fail' | 'warning' = 'pass';
    if (steps.some((s) => s.status === 'error')) {
      overallStatus = 'fail';
    } else if (steps.some((s) => s.status === 'warning')) {
      overallStatus = 'warning';
    }

    return {
      timestamp,
      steps,
      overallStatus,
    };
  }
}
