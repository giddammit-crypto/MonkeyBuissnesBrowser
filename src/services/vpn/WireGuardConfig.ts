export interface WireGuardPeer {
  publicKey: string;
  endpoint?: string;
  allowedIPs: string[];
  persistentKeepalive?: number;
  presharedKey?: string;
}

export interface WireGuardConfig {
  privateKey: string;
  address: string[];
  dns: string[];
  mtu?: number;
  peers: WireGuardPeer[];
}

const keyPattern = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

function splitList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function isValidCidr(value: string): boolean {
  const [address, prefix] = value.split('/');
  if (!address || !prefix || !/^\d+$/.test(prefix)) return false;
  const prefixNumber = Number(prefix);
  if (address.includes(':')) return prefixNumber >= 0 && prefixNumber <= 128;
  const octets = address.split('.');
  return octets.length === 4 && octets.every((octet) => /^\d+$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255) && prefixNumber >= 0 && prefixNumber <= 32;
}

function isValidEndpoint(value: string): boolean {
  return /^(?:\[[^\]]+\]|[^:\s]+):\d{1,5}$/.test(value) && Number(value.match(/(\d{1,5})$/)?.[1]) <= 65535;
}

export function parseWireGuardConfig(raw: string): { config?: WireGuardConfig; errors: string[] } {
  const errors: string[] = [];
  let section = '';
  let interfaceConfig: Record<string, string> = {};
  let peerConfig: Record<string, string> = {};
  const peers: WireGuardPeer[] = [];

  const flushPeer = () => {
    if (!Object.keys(peerConfig).length) return;
    const publicKey = peerConfig.PublicKey;
    if (!publicKey || !keyPattern.test(publicKey)) errors.push('Каждый Peer должен содержать корректный PublicKey.');
    const allowedIPs = splitList(peerConfig.AllowedIPs);
    if (!allowedIPs.length) errors.push('У Peer должен быть указан AllowedIPs.');
    if (peerConfig.PostUp || peerConfig.PostDown || peerConfig.PreUp || peerConfig.PreDown) errors.push('Командные hooks в конфигурации WireGuard запрещены.');
    if (peerConfig.Endpoint && !isValidEndpoint(peerConfig.Endpoint)) errors.push('Endpoint Peer имеет неверный формат.');
    if (peerConfig.PersistentKeepalive && (!/^\d+$/.test(peerConfig.PersistentKeepalive) || Number(peerConfig.PersistentKeepalive) > 65535)) errors.push('PersistentKeepalive имеет неверное значение.');
    peers.push({
      publicKey: publicKey ?? '',
      endpoint: peerConfig.Endpoint,
      allowedIPs,
      persistentKeepalive: peerConfig.PersistentKeepalive ? Number(peerConfig.PersistentKeepalive) : undefined,
      presharedKey: peerConfig.PresharedKey,
    });
    peerConfig = {};
  };

  for (const [index, rawLine] of raw.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      if (section === 'Peer') flushPeer();
      section = line.slice(1, -1);
      if (section !== 'Interface' && section !== 'Peer') errors.push(`Неизвестная секция в строке ${index + 1}.`);
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) { errors.push(`Некорректная строка ${index + 1}.`); continue; }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (section === 'Interface') interfaceConfig[key] = value;
    else if (section === 'Peer') peerConfig[key] = value;
    else errors.push(`Параметр вне секции в строке ${index + 1}.`);
  }
  if (section === 'Peer') flushPeer();

  if (interfaceConfig.PostUp || interfaceConfig.PostDown || interfaceConfig.PreUp || interfaceConfig.PreDown) errors.push('Командные hooks в конфигурации WireGuard запрещены.');

  if (!keyPattern.test(interfaceConfig.PrivateKey ?? '')) errors.push('Interface.PrivateKey отсутствует или имеет неверный формат.');
  const addresses = splitList(interfaceConfig.Address);
  if (!addresses.length) errors.push('Interface.Address обязателен.');
  if (addresses.some((address) => !isValidCidr(address))) errors.push('Interface.Address содержит неверный CIDR.');
  const dns = splitList(interfaceConfig.DNS);
  if (dns.some((address) => !address.includes('.') && !address.includes(':'))) errors.push('Interface.DNS содержит неверный адрес.');
  if (interfaceConfig.MTU && (!/^\d+$/.test(interfaceConfig.MTU) || Number(interfaceConfig.MTU) < 576 || Number(interfaceConfig.MTU) > 65535)) errors.push('Interface.MTU должен быть в диапазоне 576–65535.');
  if (!peers.length) errors.push('Нужен хотя бы один Peer.');

  if (errors.length) return { errors };
  return {
    errors: [],
    config: {
      privateKey: interfaceConfig.PrivateKey,
      address: addresses,
      dns,
      mtu: interfaceConfig.MTU ? Number(interfaceConfig.MTU) : undefined,
      peers,
    },
  };
}
